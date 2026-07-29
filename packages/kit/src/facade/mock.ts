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
  campaigns: CampaignsResponse = {
    campaigns: [
      {
        name: 'The Darkened Cavern',
        path: '/campaigns/darkened_cavern_v1.yaml',
        source: 'repo',
        goal: 'dm:the_darkened_cavern',
      },
    ],
    searched: ['/campaigns'],
  }
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

  async listCampaigns(): Promise<CampaignsResponse> {
    return this.campaigns
  }

  async recall(): Promise<RecallResponse> {
    return this.recallSnapshot
  }

  /** What a mocked talk turn replies with. */
  replyText: string | null = null

  async run(request: RunRequest): Promise<RunAccepted> {
    this.requests.push({ endpoint: '/api/run', body: request })
    return {
      session_id: 'mock-session',
      mode: request.mode,
      status: 'started',
      reply: request.mode === 'talk' ? this.replyText : null,
    }
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

let wireSeq = 0

/**
 * Test factory for valid v2 envelopes (kind = lowercased sim_log subsystem,
 * tier defaults to 'bio' — the server's unknown-subsystem default; meta-kinds
 * like heartbeat should pass tier: 'clean').
 */
export function wireEvent(kind: string, over: Partial<ConsoleEvent> = {}): ConsoleEvent {
  wireSeq += 1
  return { kind, ts: wireSeq, seq: wireSeq, tier: 'bio', message: '', ...over }
}
