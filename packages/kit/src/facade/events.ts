import type { ConsoleEvent } from './types'

type EventHandler = (event: ConsoleEvent) => void

/** Minimal WebSocket surface we need — lets tests inject a fake. */
export interface WsLike {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  close(): void
}

export type WsFactory = (url: string) => WsLike

const BACKOFF_BASE_MS = 500
const BACKOFF_CAP_MS = 8_000

/**
 * WsEventSource — the EventClient transport over `maxim serve`'s /ws stream.
 *
 * Connects lazily on the first subscriber, dispatches ConsoleEvent envelopes
 * by `kind` (subscribe to `'*'` for every event), reconnects with capped
 * exponential backoff while subscribers exist, and closes the socket when the
 * last subscriber leaves. The skeleton stream is heartbeat-only; the full
 * api.on() bridge lands with maxim serve Phase 3 — this transport is already
 * shaped for it.
 */
export class WsEventSource {
  private handlers = new Map<string, Set<EventHandler>>()
  private ws: WsLike | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private stopped = true

  constructor(
    private resolveUrl: () => string,
    private wsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike,
  ) {}

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
    const ws = this.wsFactory(this.resolveUrl())
    this.ws = ws
    ws.onopen = () => {
      this.attempts = 0
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
