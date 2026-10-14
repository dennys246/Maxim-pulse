/**
 * The Layer-1 facade contract — typed ENTIRELY from the generated schema.
 *
 * ./schema.ts is generated (`pnpm gen:facade`) from packages/kit/openapi.json,
 * which mirrors pymaxim's committed contract artifact
 * (src/maxim/console/openapi.json, written by `maxim serve --dump-openapi`).
 * The generated types are the single source of truth for wire shapes — never
 * hand-write a request/response shape here; derive it from `components`.
 * CI runs `gen:facade:check` so a stale schema.ts fails loudly.
 *
 * To pick up a pymaxim schema change: copy the new artifact over
 * packages/kit/openapi.json, run `pnpm gen:facade`, commit both.
 */
import type { components } from './schema'

export type ModelInfo = components['schemas']['ModelInfoWire']
export type PlatformWire = components['schemas']['PlatformWire']
export type ModelsResponse = components['schemas']['ModelsResponse']
export type DiagnoseSection = components['schemas']['DiagnoseSection']
export type DiagnoseResponse = components['schemas']['DiagnoseResponse']
export type ProbeRequest = components['schemas']['ProbeRequest']
export type ProbeResult = components['schemas']['ProbeResult']
export type MeshSetupRequest = components['schemas']['MeshSetupRequest']
export type CloudSetupRequest = components['schemas']['CloudSetupRequest']
export type SetupResult = components['schemas']['SetupResult']
export type StoryMemory = components['schemas']['StoryMemory']
export type Preference = components['schemas']['Preference']
export type RecallResponse = components['schemas']['RecallResponse']
/** GET /api/hello — the ONE tokenless surface: contract version + auth scheme. */
export type HelloResponse = components['schemas']['HelloResponse']
/** POST /api/pair/request — 202; the code is ANNOUNCED, never returned. */
export type PairRequestAccepted = components['schemas']['PairRequestAccepted']
export type PairClaimRequest = components['schemas']['PairClaimRequest']
/** POST /api/pair/claim — the spoken code exchanged for the console token. */
export type PairClaimResult = components['schemas']['PairClaimResult']
export type IdentityResponse = components['schemas']['IdentityResponse']
export type SeamStatus = components['schemas']['SeamStatus']
export type CampaignInfo = components['schemas']['CampaignInfo']
export type CampaignsResponse = components['schemas']['CampaignsResponse']
export type RunRequest = components['schemas']['RunRequest']
export type RunAccepted = components['schemas']['RunAccepted']
// Run history + health (contract 0.6.0). Read-only; every field a reader
// cannot rely on is nullable: "not recorded" is never a fake zero.
export type RunSummary = components['schemas']['RunSummary']
export type RunPage = components['schemas']['RunPage']
export type RunReport = components['schemas']['RunReport']
export type ActionRecord = components['schemas']['ActionRecord']
export type ActionPage = components['schemas']['ActionPage']
export type HealthRecord = components['schemas']['HealthRecord']
export type HealthResponse = components['schemas']['HealthResponse']
export type DegradedSite = components['schemas']['DegradedSite']
export type DegradedResponse = components['schemas']['DegradedResponse']
/** Client→server /ws filter; meta-kinds bypass it server-side. */
export type SubscribeFrame = components['schemas']['SubscribeFrame']
/** The /ws stream envelope (exposed at GET /api/events/envelope for type-gen). */
export type ConsoleEvent = components['schemas']['ConsoleEvent']

/**
 * FacadeClient — the Layer-1 binding every kit component takes its data through
 * (never a shell-specific prop or back-channel). Methods map 1:1 to the
 * `maxim serve` facade endpoints; `on()` subscribes to the /ws event stream.
 */
export interface FacadeClient {
  /**
   * GET /api/hello — reachable WITHOUT a token: which contract the server
   * speaks and whether it demands one ("bearer") or is sandboxed ("none").
   */
  hello(): Promise<HelloResponse>
  /**
   * POST /api/pair/request — ask the DEVICE to speak a 6-digit code
   * (tokenless, 202). Only device deployments register an announcer; every
   * plain `maxim serve` refuses 409. The code is never in the response.
   */
  pairRequest(): Promise<PairRequestAccepted>
  /**
   * POST /api/pair/claim — exchange the spoken code for the console token
   * (tokenless, single use). The result carries a live credential: hand it
   * straight to the AuthSession, never to a log or a URL.
   */
  pairClaim(code: string): Promise<PairClaimResult>
  /** GET /api/models */
  listModels(): Promise<ModelsResponse>
  /** GET /api/diagnose */
  diagnose(): Promise<DiagnoseResponse>
  /** POST /api/probe */
  probe(request: ProbeRequest): Promise<ProbeResult>
  /** POST /api/setup/mesh */
  setupMesh(request: MeshSetupRequest): Promise<SetupResult>
  /** POST /api/setup/cloud */
  setupCloud(request: CloudSetupRequest): Promise<SetupResult>
  /** GET /api/identity — which backend am I talking to, and which seams are live. */
  identity(): Promise<IdentityResponse>
  /** GET /api/campaigns — what the shell offers in the Adventure picker. */
  listCampaigns(): Promise<CampaignsResponse>
  /** GET /api/recall */
  recall(): Promise<RecallResponse>
  /** POST /api/run */
  run(request: RunRequest): Promise<RunAccepted>
  /** GET /api/runs — past runs, newest first (seam `runs`). */
  listRuns(page?: { cursor?: string; limit?: number }): Promise<RunPage>
  /** GET /api/runs/{session_id} — one run's report. `sessionId` is the SIM session id. */
  getRun(sessionId: string): Promise<RunReport>
  /** GET /api/runs/{session_id}/actions — the run's actions, in order. */
  listActions(sessionId: string, page?: { cursor?: string; limit?: number }): Promise<ActionPage>
  /** GET /api/health — this server's health (seam `health`). */
  health(since?: number): Promise<HealthResponse>
  /** GET /api/health/degraded — swallowed exceptions grouped by site (seam `degraded`). */
  degraded(since?: number): Promise<DegradedResponse>
  /** Subscribe to /ws events by kind ('*' = every event); returns an unsubscribe function. */
  on(kind: string, handler: (event: ConsoleEvent) => void): () => void
}
