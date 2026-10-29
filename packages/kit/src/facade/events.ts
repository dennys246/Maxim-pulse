import type { ConsoleEvent, SubscribeFrame } from './types'

type EventHandler = (event: ConsoleEvent) => void

/** Minimal WebSocket surface we need — lets tests inject a fake. */
export interface WsLike {
  onopen: (() => void) | null
  /** Client→server frames (SubscribeFrame). Absent on receive-only fakes. */
  send?: (data: string) => void
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  close(): void
}

/** `protocols` is the Sec-WebSocket-Protocol offer (the bearer transport). */
export type WsFactory = (url: string, protocols: string[]) => WsLike

const BACKOFF_BASE_MS = 500
const BACKOFF_CAP_MS = 8_000
/**
 * An open socket silent this long is presumed dead (a laptop that slept leaves
 * one behind with no close event). pymaxim's /ws sends a heartbeat every 15 s
 * when idle (`_HEARTBEAT_INTERVAL_S`), so two missed beats plus slack.
 */
const STALE_AFTER_MS = 35_000

/**
 * Something that says "now is a good moment to check the connection": the tab
 * became visible again, or the network came back. Returns its unsubscribe.
 */
export type WakeSource = (wake: () => void) => () => void

/** The browser's wake signals: `visibilitychange` (to visible) and `online`. */
export const browserWakeSource: WakeSource = (wake) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const onVisible = () => {
    if (document.visibilityState === 'visible') wake()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', wake)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', wake)
  }
}

export interface WsEventSourceOptions {
  resolveUrl: () => string
  wsFactory?: WsFactory
  /** Optional server-side filter, re-sent on every (re)connection. */
  subscribe?: SubscribeFrame
  /**
   * Subprotocols to offer on each connection, or null to HOLD: no socket is
   * opened until `resume()`. This is how the bearer transport works in a
   * browser (no upgrade headers): the token rides the offer, and with no
   * token on a bearer server there is nothing to offer — a handshake the
   * server is known to refuse would only produce a reconnect loop.
   */
  resolveProtocols?: () => string[] | null
  /**
   * A connection closed before it ever opened — the handshake was refused
   * (auth, origin, or the server is simply down; the browser reports all of
   * them as a 1006 with no server close code). The owner decides what it
   * means; the source keeps backing off meanwhile unless suspended.
   */
  onHandshakeRefused?: () => void
  /**
   * OPT-IN kinds (contract 0.6.0: `health`, `health_stall`) to add to this
   * stream — but only once the connection's own `identity` frame declares
   * `whenSeamLive` live. NEVER sent blind: a 0.5.0 server reads `kinds` as a
   * FILTER, so `{kinds: ["health"]}` would starve the client of every other
   * event. A 0.6.0 server reads opt-in kinds as additive.
   */
  optIn?: { kinds: string[]; whenSeamLive: string }
  /** When to check the connection early. Defaults to the browser's signals. */
  wakeSource?: WakeSource
  /** Clock, for tests. */
  now?: () => number
}

/** Does this identity frame declare `seam` live? (the envelope's data is the IdentityResponse) */
function declaresLive(event: ConsoleEvent, seam: string): boolean {
  const seams = (event.data as { seams?: Array<{ name?: unknown; live?: unknown }> } | undefined)
    ?.seams
  return Array.isArray(seams) && seams.some((s) => s?.name === seam && s?.live === true)
}

/**
 * WsEventSource — the EventClient transport over `maxim serve`'s /ws stream.
 *
 * Connects lazily on the first subscriber, dispatches ConsoleEvent envelopes
 * by `kind` (subscribe to `'*'` for every event), reconnects with capped
 * exponential backoff while subscribers exist, and closes the socket when the
 * last subscriber leaves. The EVENT seam is LIVE server-side: /ws streams
 * sim_log records as v2 envelopes (kind = lowercased subsystem, tier as the
 * typed filter axis, seq/run_id, drop-oldest backpressure with a "dropped"
 * meta-event).
 *
 * CREDENTIALS (contract 0.4.0): the offer is `["maxim-console-v1",
 * "maxim.bearer.<token>"]`; the server validates BEFORE accept and echoes
 * `maxim-console-v1`. Offering subprotocols without the app one is refused at
 * the handshake by design, so the offer always carries it.
 *
 * SUBSCRIBE FILTERING: pass a SubscribeFrame and it is sent on every
 * connection (each one filters independently, and a reconnect needs its own).
 * Meta-kinds — heartbeat, run, dropped, display, identity — bypass filters
 * server-side, so run lifecycle and backend identity survive any filter. A
 * shell that renders no bio-tier surface can subscribe at tier "clean" and
 * drop the ~87%% of traffic the idle loop generates, which is the difference
 * between a comfortable and a busy socket on a Pi.
 */
export class WsEventSource {
  private handlers = new Map<string, Set<EventHandler>>()
  private ws: WsLike | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  /** No subscribers (or deliberately disconnected): never reconnect. */
  private stopped = true
  /** Credentials unavailable: wanted, but waiting for resume(). */
  private held = false
  private resolveUrl: () => string
  private wsFactory: WsFactory
  private subscribe?: SubscribeFrame
  private resolveProtocols: () => string[] | null
  private onHandshakeRefused?: () => void
  private optIn?: { kinds: string[]; whenSeamLive: string }
  private wakeSource: WakeSource
  private now: () => number
  private unwake: (() => void) | null = null
  /** The current socket has opened (not merely been created). */
  private open = false
  private lastMessageAt = 0
  /** Some connection opened since subscribers arrived: the next open follows a gap. */
  private hadOpened = false
  private gapHandlers = new Set<() => void>()

  constructor(options: WsEventSourceOptions) {
    this.resolveUrl = options.resolveUrl
    this.wsFactory =
      options.wsFactory ??
      ((url, protocols) =>
        new WebSocket(url, protocols.length > 0 ? protocols : undefined) as unknown as WsLike)
    this.subscribe = options.subscribe
    this.resolveProtocols = options.resolveProtocols ?? (() => [])
    this.onHandshakeRefused = options.onHandshakeRefused
    this.optIn = options.optIn
    this.wakeSource = options.wakeSource ?? browserWakeSource
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Called when a connection opens after an earlier one was lost. `seq` restarts
   * per connection and /ws replays nothing, so whatever was sent in between is
   * gone: refetch what can be refetched (the run list), don't trust a live tally.
   */
  onGap(handler: () => void): () => void {
    this.gapHandlers.add(handler)
    return () => this.gapHandlers.delete(handler)
  }

  /**
   * Check the connection now instead of waiting out the backoff: reconnect at
   * once if there is no socket, or if the open one has gone silent. A healthy
   * socket, a handshake in flight, and held credentials are left alone.
   */
  wake(): void {
    if (this.subscriberCount() === 0 || this.held) return
    if (this.ws != null && !this.open) return // a handshake is in flight
    if (this.ws != null && this.now() - this.lastMessageAt <= STALE_AFTER_MS) return
    this.teardown()
    this.ensureConnected()
  }

  on(kind: string, handler: EventHandler): () => void {
    const set = this.handlers.get(kind) ?? new Set()
    set.add(handler)
    this.handlers.set(kind, set)
    this.ensureConnected()
    return () => {
      set.delete(handler)
      if (set.size === 0) this.handlers.delete(kind)
      if (this.subscriberCount() === 0) this.disconnect()
    }
  }

  /**
   * Drop the socket and stop reconnecting, keeping subscribers. Used when
   * credentials are known to be dead (a refused token): retrying would be
   * the silent loop the auth flow forbids.
   */
  suspend(): void {
    if (this.subscriberCount() === 0) return
    this.teardown()
    this.held = true
  }

  /** Credentials arrived (or changed): (re)connect if anyone is listening. */
  resume(): void {
    if (this.subscriberCount() === 0) return
    if (this.ws != null || this.retryTimer != null) {
      // a live socket holds the OLD offer; reconnect with the new one
      this.teardown()
    }
    this.held = false
    this.ensureConnected()
  }

  private subscriberCount(): number {
    let count = 0
    for (const set of this.handlers.values()) count += set.size
    return count
  }

  private ensureConnected(): void {
    this.unwake ??= this.wakeSource(() => this.wake())
    if (this.ws != null || this.retryTimer != null) return
    this.stopped = false
    this.connect()
  }

  private connect(): void {
    const protocols = this.resolveProtocols()
    if (protocols === null) {
      this.held = true
      return
    }
    this.held = false
    const ws = this.wsFactory(this.resolveUrl(), protocols)
    this.ws = ws
    this.open = false
    let opened = false
    let optedIn = false
    ws.onopen = () => {
      opened = true
      this.open = true
      this.lastMessageAt = this.now()
      this.attempts = 0
      if (this.subscribe != null && ws.send != null) {
        ws.send(JSON.stringify(this.subscribe))
      }
      if (this.hadOpened) this.gapHandlers.forEach((handler) => handler())
      this.hadOpened = true
    }
    ws.onmessage = (message) => {
      this.lastMessageAt = this.now()
      let event: ConsoleEvent
      try {
        event = JSON.parse(String(message.data)) as ConsoleEvent
      } catch {
        return // not an envelope; ignore
      }
      // Every connection opens with an identity frame: the earliest moment this
      // socket knows whether its server speaks the opt-in rule.
      if (!optedIn && this.optIn != null && event.kind === 'identity' && ws.send != null) {
        optedIn = true
        if (declaresLive(event, this.optIn.whenSeamLive)) {
          const base = this.subscribe ?? {}
          ws.send(JSON.stringify({ ...base, kinds: [...(base.kinds ?? []), ...this.optIn.kinds] }))
        }
      }
      this.dispatch(event)
    }
    ws.onerror = null
    ws.onclose = () => {
      this.ws = null
      this.open = false
      if (this.stopped || this.subscriberCount() === 0) return
      if (!opened) this.onHandshakeRefused?.()
      if (this.held || this.stopped) return // the refusal handler suspended us
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempts, BACKOFF_CAP_MS)
      this.attempts += 1
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        this.connect()
      }, delay)
    }
  }

  private dispatch(event: ConsoleEvent): void {
    this.handlers.get(event.kind)?.forEach((handler) => handler(event))
    this.handlers.get('*')?.forEach((handler) => handler(event))
  }

  private disconnect(): void {
    this.teardown()
    this.held = false
    this.hadOpened = false // a fresh subscriber starts a fresh stream, not a gap
    this.unwake?.()
    this.unwake = null
  }

  private teardown(): void {
    this.stopped = true
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.attempts = 0
    this.open = false
    const ws = this.ws
    this.ws = null
    if (ws != null) {
      ws.onclose = null
      ws.close()
    }
  }
}
