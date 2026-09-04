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

  constructor(options: WsEventSourceOptions) {
    this.resolveUrl = options.resolveUrl
    this.wsFactory =
      options.wsFactory ??
      ((url, protocols) =>
        new WebSocket(url, protocols.length > 0 ? protocols : undefined) as unknown as WsLike)
    this.subscribe = options.subscribe
    this.resolveProtocols = options.resolveProtocols ?? (() => [])
    this.onHandshakeRefused = options.onHandshakeRefused
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
    let opened = false
    ws.onopen = () => {
      opened = true
      this.attempts = 0
      if (this.subscribe != null && ws.send != null) {
        ws.send(JSON.stringify(this.subscribe))
      }
    }
    ws.onmessage = (message) => {
      let event: ConsoleEvent
      try {
        event = JSON.parse(String(message.data)) as ConsoleEvent
      } catch {
        return // not an envelope; ignore
      }
      this.dispatch(event)
    }
    ws.onerror = null
    ws.onclose = () => {
      this.ws = null
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
  }

  private teardown(): void {
    this.stopped = true
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.attempts = 0
    const ws = this.ws
    this.ws = null
    if (ws != null) {
      ws.onclose = null
      ws.close()
    }
  }
}
