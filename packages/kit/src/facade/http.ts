import { AuthSession } from './auth'
import { WsEventSource, type WsFactory } from './events'
import type {
  CampaignsResponse,
  IdentityResponse,
  CloudSetupRequest,
  ConsoleEvent,
  DiagnoseResponse,
  FacadeClient,
  HelloResponse,
  MeshSetupRequest,
  ModelsResponse,
  ProbeRequest,
  ProbeResult,
  RecallResponse,
  RunAccepted,
  RunRequest,
  SetupResult,
  SubscribeFrame,
} from './types'

/**
 * Error thrown for any non-2xx facade response. `status` 501 means the seam
 * behind the endpoint hasn't landed in pymaxim yet (the contract is typed
 * before the bodies exist) — components should render that as "not available
 * yet", not as a crash.
 */
export class FacadeError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly path: string,
  ) {
    super(`${path} → HTTP ${status}: ${detail}`)
    this.name = 'FacadeError'
  }
}

/**
 * A 401: the console token is missing or refused. Surfaced as AUTH STATE
 * (the AuthSession is told, and the shell returns to the login screen) — this
 * error exists so a component's generic catch can tell it apart from a real
 * failure and stay quiet rather than paint an error the gate is about to
 * replace.
 */
export class AuthError extends FacadeError {
  constructor(detail: string, path: string) {
    super(401, detail, path)
    this.name = 'AuthError'
  }
}

export interface HttpFacadeOptions {
  /**
   * Origin of `maxim serve`. Default '' = same origin, which is correct in
   * both real deployments (serve hosts the bundle) and dev (Vite proxies
   * /api + /ws). Set explicitly only for tests/tools.
   */
  baseUrl?: string
  fetchImpl?: typeof fetch
  wsFactory?: WsFactory
  /**
   * Server-side stream filter. Omit to receive everything (the Console needs
   * bio-tier records for its activity panel); a shell rendering only clean
   * surfaces should pass `{ tier: 'clean' }`.
   */
  subscribe?: SubscribeFrame
  /**
   * The credential the shell shares with its AuthGate. Default: a fresh
   * localStorage-backed session (fine for a shell that never renders a login
   * screen; a shell that does must pass the SAME session to both).
   */
  auth?: AuthSession
}

/**
 * HttpFacade — the real FacadeClient over `maxim serve` (127.0.0.1-only).
 * Methods map 1:1 to the pinned endpoints; all shapes come from the generated
 * contract. Events ride WsEventSource over /ws.
 *
 * CREDENTIALS (contract 0.4.0): every HTTP call carries
 * `Authorization: Bearer <token>` when a token is held; /ws offers the
 * `maxim.bearer.<token>` subprotocol beside `maxim-console-v1`. A 401 with a
 * held token means the token is dead (rotated): it is reported to the
 * AuthSession, which drops it — the stream suspends and the gate re-logins.
 * Never a silent retry with a refused token.
 */
export class HttpFacade implements FacadeClient {
  readonly auth: AuthSession
  private baseUrl: string
  private fetchImpl: typeof fetch
  private events: WsEventSource

  constructor(options: HttpFacadeOptions = {}) {
    this.baseUrl = options.baseUrl ?? ''
    // Bound: a bare `fetch` called as a method (`this.fetchImpl(...)`) has
    // `this` = the facade, and Chrome refuses that with "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.auth = options.auth ?? new AuthSession()
    this.events = new WsEventSource({
      resolveUrl: () => this.wsUrl(),
      wsFactory: options.wsFactory,
      subscribe: options.subscribe,
      resolveProtocols: () => this.auth.wsProtocols(),
      onHandshakeRefused: () => void this.confirmCredentials(),
    })
    this.auth.subscribe(() => {
      if (this.auth.canConnect()) this.events.resume()
      else this.events.suspend()
    })
  }

  private wsUrl(): string {
    const origin = this.baseUrl !== '' ? this.baseUrl : window.location.origin
    return origin.replace(/^http/, 'ws') + '/ws'
  }

  /**
   * A refused /ws handshake looks the same from a browser whether the token
   * was rotated, the origin was refused, or the server is down. Ask over
   * HTTP: a 401 on the cheapest authed read is the rotation signal (and
   * `request` routes it into the session); anything else is not an auth
   * problem, so the source keeps backing off as usual.
   */
  private async confirmCredentials(): Promise<void> {
    if (this.auth.token() === null) return
    try {
      await this.identity()
    } catch {
      /* 401 already reported by request(); other failures are not ours */
    }
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const token = this.auth.token()
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token !== null) headers['Authorization'] = `Bearer ${token}`
    const response = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      let detail = response.statusText
      try {
        const data: unknown = await response.json()
        if (
          typeof data === 'object' &&
          data !== null &&
          'detail' in data &&
          typeof data.detail === 'string'
        ) {
          detail = data.detail
        }
      } catch {
        // non-JSON error body; keep statusText
      }
      if (response.status === 401) {
        // Only a token we actually SENT can be "rejected"; a tokenless 401
        // is the gate's normal pre-login state, not a rotation.
        if (token !== null && this.auth.token() === token) this.auth.reject()
        throw new AuthError(detail, path)
      }
      throw new FacadeError(response.status, detail, path)
    }
    return response.json() as Promise<T>
  }

  hello(): Promise<HelloResponse> {
    return this.request('GET', '/api/hello')
  }

  listModels(): Promise<ModelsResponse> {
    return this.request('GET', '/api/models')
  }

  diagnose(): Promise<DiagnoseResponse> {
    return this.request('GET', '/api/diagnose')
  }

  probe(request: ProbeRequest): Promise<ProbeResult> {
    return this.request('POST', '/api/probe', request)
  }

  setupMesh(request: MeshSetupRequest): Promise<SetupResult> {
    return this.request('POST', '/api/setup/mesh', request)
  }

  setupCloud(request: CloudSetupRequest): Promise<SetupResult> {
    return this.request('POST', '/api/setup/cloud', request)
  }

  identity(): Promise<IdentityResponse> {
    return this.request('GET', '/api/identity')
  }

  listCampaigns(): Promise<CampaignsResponse> {
    return this.request('GET', '/api/campaigns')
  }

  recall(): Promise<RecallResponse> {
    return this.request('GET', '/api/recall')
  }

  run(request: RunRequest): Promise<RunAccepted> {
    return this.request('POST', '/api/run', request)
  }

  on(kind: string, handler: (event: ConsoleEvent) => void): () => void {
    return this.events.on(kind, handler)
  }
}
