import { WsEventSource, type WsFactory } from './events'
import type {
  CampaignsResponse,
  CloudSetupRequest,
  ConsoleEvent,
  DiagnoseResponse,
  FacadeClient,
  MeshSetupRequest,
  ModelsResponse,
  ProbeRequest,
  ProbeResult,
  RecallResponse,
  RunAccepted,
  RunRequest,
  SetupResult,
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

export interface HttpFacadeOptions {
  /**
   * Origin of `maxim serve`. Default '' = same origin, which is correct in
   * both real deployments (serve hosts the bundle) and dev (Vite proxies
   * /api + /ws). Set explicitly only for tests/tools.
   */
  baseUrl?: string
  fetchImpl?: typeof fetch
  wsFactory?: WsFactory
}

/**
 * HttpFacade — the real FacadeClient over `maxim serve` (127.0.0.1-only).
 * Methods map 1:1 to the pinned endpoints; all shapes come from the generated
 * contract. Events ride WsEventSource over /ws.
 */
export class HttpFacade implements FacadeClient {
  private baseUrl: string
  private fetchImpl: typeof fetch
  private events: WsEventSource

  constructor(options: HttpFacadeOptions = {}) {
    this.baseUrl = options.baseUrl ?? ''
    this.fetchImpl = options.fetchImpl ?? fetch
    this.events = new WsEventSource(() => this.wsUrl(), options.wsFactory)
  }

  private wsUrl(): string {
    const origin = this.baseUrl !== '' ? this.baseUrl : window.location.origin
    return origin.replace(/^http/, 'ws') + '/ws'
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
      throw new FacadeError(response.status, detail, path)
    }
    return response.json() as Promise<T>
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
