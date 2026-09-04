/**
 * Console auth — the client half of pymaxim's bearer-token flow (contract
 * 0.4.0; docs/plans/console_tunnel_hardening.md decisions A4–A6).
 *
 * The server side, exactly:
 *   - `GET /api/hello` is the ONE tokenless surface: `{contract_version, auth}`.
 *     `auth: "none"` is sandbox mode (the proxy owns the edge) — no login.
 *   - Everything else 401s without credentials (`WWW-Authenticate: Bearer`).
 *   - HTTP carries `Authorization: Bearer <token>`; browser /ws (no upgrade
 *     headers) offers the subprotocols `["maxim-console-v1", "maxim.bearer.<token>"]`.
 *     Offering ANY subprotocol without `maxim-console-v1` is refused 1008.
 *   - The token is handed to the UI as a URL FRAGMENT (`/#token=<t>`), never a
 *     query: fragments never reach the server or its access logs.
 *   - Rotation (`maxim serve --rotate-token`) invalidates the old token on the
 *     NEXT request — a stored token can 401 at any moment.
 *
 * Persistence contract: authenticate once per device, ever. The token is a
 * static credential (localStorage), not a session — no expiry, no periodic
 * re-login. A 401 with a stored token is the rotation signal: the token is
 * dropped and the shell returns to the paste screen with the rotation hint.
 * Never a silent retry loop.
 *
 * This module is framework-free; the React side (AuthGate/LoginScreen) sits
 * on top via `subscribe()`.
 */

export const WS_APP_SUBPROTOCOL = 'maxim-console-v1'
export const WS_BEARER_PREFIX = 'maxim.bearer.'
export const TOKEN_STORAGE_KEY = 'maxim.console.token'

/** `mxc_` + 43 url-safe chars (token_urlsafe(32) with a recognizable prefix). */
const TOKEN_SHAPE = /^mxc_[A-Za-z0-9_-]{43}$/

export function isTokenShaped(value: string): boolean {
  return TOKEN_SHAPE.test(value)
}

/**
 * Pull a token out of whatever the operator pasted: the bare token, or the
 * whole printed `http://127.0.0.1:8765/#token=<t>` line. Returns null when
 * nothing token-shaped is there.
 */
export function extractToken(input: string): string | null {
  const trimmed = input.trim()
  const fromFragment = /#token=([^&\s]+)/.exec(trimmed)
  const candidate = fromFragment != null ? fromFragment[1]! : trimmed
  return isTokenShaped(candidate) ? candidate : null
}

export interface TokenStore {
  get(): string | null
  set(token: string): void
  clear(): void
}

export class MemoryTokenStore implements TokenStore {
  private value: string | null = null
  get() {
    return this.value
  }
  set(token: string) {
    this.value = token
  }
  clear() {
    this.value = null
  }
}

/**
 * localStorage-backed, with an in-memory fallback when storage throws
 * (private windows, blocked site data) — a blocked store must degrade to
 * "sign in again next load", never to a crash on first paint.
 */
export class LocalStorageTokenStore implements TokenStore {
  private fallback = new MemoryTokenStore()
  constructor(private key: string = TOKEN_STORAGE_KEY) {}
  get() {
    try {
      return window.localStorage.getItem(this.key) ?? this.fallback.get()
    } catch {
      return this.fallback.get()
    }
  }
  set(token: string) {
    this.fallback.set(token)
    try {
      window.localStorage.setItem(this.key, token)
    } catch {
      /* memory fallback holds it for this page's lifetime */
    }
  }
  clear() {
    this.fallback.clear()
    try {
      window.localStorage.removeItem(this.key)
    } catch {
      /* nothing stored */
    }
  }
}

/** What /api/hello told us the server demands; 'unknown' until it answers. */
export type AuthMode = 'unknown' | 'bearer' | 'none'

export interface AuthSnapshot {
  mode: AuthMode
  token: string | null
  /**
   * The stored token was refused (401 / refused /ws handshake) and has been
   * dropped — the rotation signal. Cleared by the next setToken().
   */
  rejected: boolean
}

export interface AuthSessionOptions {
  store?: TokenStore
  mode?: AuthMode
}

/**
 * AuthSession — the one object both transports and the login UI share.
 * HttpFacade reads the token from it (Bearer header, ws subprotocols) and
 * reports refusals into it; AuthGate renders from its snapshot and
 * LoginScreen writes pasted tokens into it.
 */
export class AuthSession {
  private store: TokenStore
  private current: AuthSnapshot
  private listeners = new Set<(snapshot: AuthSnapshot) => void>()

  constructor(options: AuthSessionOptions = {}) {
    this.store = options.store ?? new LocalStorageTokenStore()
    this.current = { mode: options.mode ?? 'unknown', token: this.store.get(), rejected: false }
  }

  /** Stable until the next change — safe for useSyncExternalStore. */
  snapshot(): AuthSnapshot {
    return this.current
  }

  token(): string | null {
    return this.current.token
  }

  setMode(mode: AuthMode): void {
    if (mode === this.current.mode) return
    this.update({ ...this.current, mode })
  }

  setToken(token: string): void {
    this.store.set(token)
    this.update({ ...this.current, token, rejected: false })
  }

  clearToken(): void {
    this.store.clear()
    this.update({ ...this.current, token: null, rejected: false })
  }

  /**
   * The server refused the stored token. It is dead (rotated, or never
   * valid): drop it so no transport retries with it, and flag the refusal so
   * the login screen can say why.
   */
  reject(): void {
    if (this.current.token === null) return
    this.store.clear()
    this.update({ ...this.current, token: null, rejected: true })
  }

  /**
   * Consume `#token=<t>` from the page URL: store it and strip it from the
   * address bar (history.replaceState) so it is never bookmarked, shared or
   * re-read. Returns whether a token was consumed. Safe to call outside a
   * browser (no-op).
   */
  bootstrapFromLocation(win: Pick<Window, 'location' | 'history'> | undefined = globalThis.window) {
    if (win == null) return false
    const hash = win.location.hash.replace(/^#/, '')
    if (hash === '') return false
    const params = new URLSearchParams(hash)
    const token = params.get('token')
    if (token === null) return false
    params.delete('token')
    const rest = params.toString()
    win.history.replaceState(
      null,
      '',
      win.location.pathname + win.location.search + (rest === '' ? '' : `#${rest}`),
    )
    if (!isTokenShaped(token)) return false
    this.setToken(token)
    return true
  }

  /**
   * Whether the /ws transport may connect right now. Never while credentials
   * are missing on a bearer server: a handshake the server is known to refuse
   * would only produce a reconnect loop.
   */
  canConnect(): boolean {
    return this.wsProtocols() !== null
  }

  /**
   * The subprotocol offer for the next /ws connection, or null to hold off.
   * Always includes the app subprotocol (the server refuses an offer that
   * lacks it) and adds the bearer entry whenever a token is held.
   */
  wsProtocols(): string[] | null {
    const { mode, token } = this.current
    if (token !== null) return [WS_APP_SUBPROTOCOL, `${WS_BEARER_PREFIX}${token}`]
    if (mode === 'none') return [WS_APP_SUBPROTOCOL]
    return null
  }

  subscribe(listener: (snapshot: AuthSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private update(next: AuthSnapshot): void {
    this.current = next
    this.listeners.forEach((listener) => listener(next))
  }
}
