import type {
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
 * MockFacade — the offline test double behind every kit/component test.
 * No test spins up a real robot, a real LLM, or a live `maxim serve`
 * (CLAUDE.md); components render against this instead. All shapes come from
 * the generated contract, so a pymaxim schema change breaks this loudly at
 * typecheck time.
 */
export class MockFacade implements FacadeClient {
  private handlers = new Map<string, Set<(event: ConsoleEvent) => void>>()

  models: ModelsResponse = {
    groups: {
      local: [
        {
          name: 'mock-large',
          backend: 'mock',
          cloud: false,
          curated: true,
          downloaded: true,
          ready: true,
        },
      ],
    },
  }
  diagnostic: DiagnoseResponse = {
    platform: { os: 'mockos', os_release: '1.0', arch: 'arm64', runtime: 'native' },
    sections: [{ name: 'placement', status: 'ok', detail: 'thinking on mesh (mock)' }],
  }
  recallSnapshot: RecallResponse = {
    name: null,
    player_model: [],
    story_memories: [],
    preferences: [],
  }
  probeResult: ProbeResult = { status: 'ok', outcome: 'ok', message: 'mock probe ok' }
  requests: Array<{ endpoint: string; body: unknown }> = []

  async listModels(): Promise<ModelsResponse> {
    return this.models
  }

  async diagnose(): Promise<DiagnoseResponse> {
    return this.diagnostic
  }

  async probe(request: ProbeRequest): Promise<ProbeResult> {
    this.requests.push({ endpoint: '/api/probe', body: request })
    return this.probeResult
  }

  async setupMesh(request: MeshSetupRequest): Promise<SetupResult> {
    this.requests.push({ endpoint: '/api/setup/mesh', body: request })
    return { ok: true, placement: 'mesh', detail: 'mock mesh placement written' }
  }

  async setupCloud(request: CloudSetupRequest): Promise<SetupResult> {
    this.requests.push({ endpoint: '/api/setup/cloud', body: request })
    return { ok: true, placement: 'cloud', detail: 'mock cloud profile written' }
  }

  async recall(): Promise<RecallResponse> {
    return this.recallSnapshot
  }

  async run(request: RunRequest): Promise<RunAccepted> {
    this.requests.push({ endpoint: '/api/run', body: request })
    return { session_id: 'mock-session', mode: request.mode, status: 'started' }
  }

  on(kind: string, handler: (event: ConsoleEvent) => void): () => void {
    const set = this.handlers.get(kind) ?? new Set()
    set.add(handler)
    this.handlers.set(kind, set)
    return () => set.delete(handler)
  }

  /** Test helper: push an event into the stream as the /ws bridge would. */
  emit(event: ConsoleEvent): void {
    this.handlers.get(event.kind)?.forEach((handler) => handler(event))
    this.handlers.get('*')?.forEach((handler) => handler(event))
  }
}
