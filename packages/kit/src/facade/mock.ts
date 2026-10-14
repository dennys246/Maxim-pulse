import { CONTRACT_VERSION } from './contractVersion'
import { FacadeError } from './http'
import type {
  ActionPage,
  ActionRecord,
  DegradedResponse,
  HealthResponse,
  RunPage,
  RunReport,
  CampaignsResponse,
  IdentityResponse,
  CloudSetupRequest,
  ConsoleEvent,
  DiagnoseResponse,
  FacadeClient,
  HelloResponse,
  MeshSetupRequest,
  ModelsResponse,
  PairClaimResult,
  PairRequestAccepted,
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
  backend: IdentityResponse = {
    package_version: '1.0.3',
    contract_version: CONTRACT_VERSION,
    python_version: '3.12.0',
    git_branch: 'main',
    git_sha: 'abc1234',
    ui_source: 'flag',
    seams: [
      { name: 'talk', live: true, detail: null },
      { name: 'adventure', live: true, detail: null },
      { name: 'sim', live: false, detail: 'CLI only' },
      { name: 'runs', live: true, detail: '/api/runs' },
      { name: 'health', live: true, detail: '/api/health' },
      { name: 'degraded', live: true, detail: '/api/health/degraded' },
    ],
  }
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
  /**
   * auth: 'none' — a mocked backend is sandbox-shaped: NO login screen ever
   * renders over a MockFacade (the website Demo build rides this). Tests of
   * the bearer flow override it. `pairing` is the 0.5.0 device sign-in
   * surface (spoken-code); a desktop `maxim serve` reports 'none'.
   */
  greeting: HelloResponse = { contract_version: CONTRACT_VERSION, auth: 'none', pairing: 'none' }
  requests: Array<{ endpoint: string; body: unknown }> = []

  // ── run history + health fixtures (contract 0.6.0) ──
  // Three shapes the real store holds: a credit-recording (1.2) adventure with
  // one bridge-booked failure, an older run whose actions predate credit, and
  // an aborted run with no report at all.
  runs: RunPage['runs'] = [
    { session_id: '20260903_005659', started_at: 1788419000, has_report: true, mode: 'adventure',
      goal: 'dm:the_darkened_cavern', finish_reason: 'completed', turns: 6, duration_s: 412, cost_usd: 0.031,
      total_actions: 3 },
    { session_id: '20260902_101010', started_at: 1788343810, has_report: false, mode: null, goal: null,
      finish_reason: null, turns: null, duration_s: null, cost_usd: null, total_actions: null },
    { session_id: '20260901_120000', started_at: 1788264000, has_report: true, mode: 'generative',
      goal: 'dm:the_arena', finish_reason: 'llm_wedged', turns: 1, duration_s: 407, cost_usd: 0,
      total_actions: 1 },
  ] // prettier-ignore
  reports: Record<string, RunReport> = {
    '20260903_005659': { session_id: '20260903_005659', started_at: 1788419000, ended_at: 1788419412,
      format_version: '1.0', goal: 'dm:the_darkened_cavern', mode: 'adventure', finish_reason: 'completed',
      duration_s: 412, turns: 6, total_actions: 3, cost_usd: 0.031, tool_usage: { sense_tools: 2, respond: 1 },
      tool_success_rates: { sense_tools: 0.5, respond: 1 }, response_texts: [] },
    '20260901_120000': { session_id: '20260901_120000', started_at: 1788264000, ended_at: 1788264407,
      format_version: '1.0', goal: 'dm:the_arena', mode: 'generative', finish_reason: 'llm_wedged',
      duration_s: 407, turns: 1, total_actions: 1, cost_usd: 0, tool_usage: { respond: 1 },
      tool_success_rates: { respond: 1 }, response_texts: [] },
  } // prettier-ignore
  actions: Record<string, { format_version: string | null; actions: ActionRecord[] }> = {
    '20260903_005659': { format_version: '1.2', actions: [
      { timestamp: 1788419020, tool: 'sense_tools', params: {}, success: true, blocked: false, rpe: null, pain: null,
        nac_failure_booked: null, credit_recorded: true },
      { timestamp: 1788419021, tool: 'sense_tools', params: { q: 'door' }, success: false, blocked: false,
        error: 'no such door', rpe: -0.42, pain: 0.3, nac_failure_booked: 'tool:sense_tools:failure',
        credit_recorded: true },
      { timestamp: 1788419022, tool: 'respond', params: {}, success: true, blocked: false, rpe: 0.12, pain: null,
        nac_failure_booked: null, credit_recorded: true },
    ] },
    '20260901_120000': { format_version: '1.1', actions: [
      { timestamp: 1788264010, tool: 'respond', params: {}, success: true, blocked: false, rpe: null, pain: null,
        nac_failure_booked: null, credit_recorded: false },
    ] },
  } // prettier-ignore
  healthSnapshot: HealthResponse = {
    monitoring: true,
    stall_detection: false,
    recorded_since: 1788418000,
    dropped_records: 0,
    latest: {
      timestamp: 1788419400,
      cpu: { usage_pct: 23.5 },
      memory: { usage_pct: 61.2 },
      gpu: { utilization_pct: 44, vram_used_gb: 9.8, vram_total_gb: 24, temperature_c: 67 },
      lanes: { large: { p50_latency_ms: 840, jobs_completed: 42, jobs_failed: 1 } },
    },
    stalls: [],
    series: [],
  }
  degradedSites: DegradedResponse = {
    since: 0,
    counted_since: 1788418000,
    sites: [
      { site: 'executor.py:_fail_ran', count: 3, first_seen: 1788418100, last_seen: 1788419300,
        exc_type: 'TypeError', sample: 'bad arg' },
      { site: 'nac.py:_record_outcome_impl:collector', count: 1, first_seen: 1788418200,
        last_seen: 1788418200, exc_type: 'KeyError', sample: "'x'" },
    ],
  } // prettier-ignore

  async listRuns(page: { cursor?: string; limit?: number } = {}): Promise<RunPage> {
    const start = page.cursor != null ? Number(page.cursor.replace('mock:', '')) : 0
    const limit = page.limit ?? 50
    const slice = this.runs.slice(start, start + limit)
    const next = start + limit < this.runs.length ? `mock:${start + limit}` : null
    return { runs: slice, next_cursor: next }
  }

  async getRun(sessionId: string): Promise<RunReport> {
    const report = this.reports[sessionId]
    if (report == null) throw new FacadeError(404, 'No such run.', `/api/runs/${sessionId}`)
    return report
  }

  async listActions(
    sessionId: string,
    page: { cursor?: string; limit?: number } = {},
  ): Promise<ActionPage> {
    const recorded = this.actions[sessionId]
    if (recorded == null) {
      return {
        session_id: sessionId,
        available: false,
        reason: 'This run recorded no actions file.',
        actions: [],
        skipped: 0,
      }
    }
    const start = page.cursor != null ? Number(page.cursor.replace('mock:', '')) : 0
    const limit = page.limit ?? 200
    const slice = recorded.actions.slice(start, start + limit)
    const next = start + limit < recorded.actions.length ? `mock:${start + limit}` : null
    return {
      session_id: sessionId,
      available: true,
      format_version: recorded.format_version,
      actions: slice,
      next_cursor: next,
      skipped: 0,
    }
  }

  async health(): Promise<HealthResponse> {
    return this.healthSnapshot
  }

  async degraded(): Promise<DegradedResponse> {
    return this.degradedSites
  }

  async hello(): Promise<HelloResponse> {
    return this.greeting
  }

  /** The code a mocked device "speaks"; pairClaim accepts exactly this. */
  pairCode = '123456'
  /** Token handed out on a successful claim. */
  pairToken = `mxc_${'p'.repeat(43)}`

  async pairRequest(): Promise<PairRequestAccepted> {
    this.requests.push({ endpoint: '/api/pair/request', body: null })
    return { detail: 'Listen: the robot is speaking a 6-digit code.' }
  }

  async pairClaim(code: string): Promise<PairClaimResult> {
    this.requests.push({ endpoint: '/api/pair/claim', body: { code } })
    if (code !== this.pairCode) throw new FacadeError(403, 'Wrong code.', '/api/pair/claim')
    return { token: this.pairToken }
  }

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

  async identity(): Promise<IdentityResponse> {
    return this.backend
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
