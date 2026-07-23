/**
 * ⚠ TEMPORARY STAND-IN — DELETE IN PHASE 1, DO NOT MAINTAIN ALONGSIDE GENERATED TYPES.
 *
 * The real facade contract is pymaxim's `maxim serve` (FastAPI). Once its skeleton
 * lands, these types are REPLACED by types generated from its OpenAPI schema
 * (openapi-typescript or similar) — the generated types become the single source
 * of truth for the Layer-1 contract. Keeping this file alive next to them would
 * re-create the exact Python↔TS drift the generation exists to prevent.
 *
 * This hand-written sketch exists only so MockFacade and the kit components have
 * something to compile against before the server exists. Shapes follow the seams
 * in docs/plans/reachy_app_maxim_seams.md (SETUP / PROBE / RECALL / HANDLE) plus
 * the api.py verbs the kit binds to (list_models, diagnose, on()).
 */

/** PROBE — structured connection test result (mesh probe or cloud-key probe). */
export interface ProbeResult {
  ok: boolean
  target: 'mesh' | 'cloud'
  /** Friendly fix-hint on failure ("check the leader URL", "key rejected", …). */
  hint?: string
}

/** RECALL — the curated "what Maxim remembers about you" blend (never raw episodes/NAc floats). */
export interface RecallSnapshot {
  name: string | null
  playerModel: string[]
  storyMemories: Array<{ summary: string; when: string; salience: number }>
  preferences: Array<{ about: string; learnedFrom: string }>
}

/** api.list_models — curated + full profile list. */
export interface ModelInfo {
  id: string
  provider: string
  curated: boolean
}

/** api.diagnose — feeds StatusChip: where it thinks · health · spend. */
export interface DiagnosticReport {
  placement: 'local' | 'mesh-lan' | 'mesh-tunnel' | 'cloud'
  healthy: boolean
  spendMonthUsd: number
}

/** api.on() / observe — the event stream both renderers (terminal + web) consume. */
export interface MaximEvent {
  /** e.g. 'sim_log' | 'observe' | 'thinking' — pinned by the serve skeleton. */
  type: string
  payload: unknown
}

/** SETUP — the two setup-write verbs (thin helpers over pymaxim's config_writer). */
export interface SetupWrites {
  writeMeshPlacement(leaderUrl: string, accessKeyRef: string): Promise<void>
  writeCloudProfile(provider: string, model: string, monthlyCapUsd: number): Promise<void>
}

/**
 * FacadeClient — the Layer-1 binding every kit component takes its data through
 * (never a shell-specific prop or back-channel).
 */
export interface FacadeClient extends SetupWrites {
  probe(target: 'mesh' | 'cloud'): Promise<ProbeResult>
  recall(): Promise<RecallSnapshot>
  listModels(): Promise<ModelInfo[]>
  diagnose(): Promise<DiagnosticReport>
  /** Subscribe to the live event stream; returns an unsubscribe function. */
  on(type: string, handler: (event: MaximEvent) => void): () => void
}
