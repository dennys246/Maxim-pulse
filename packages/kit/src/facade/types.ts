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
export type RunRequest = components['schemas']['RunRequest']
export type RunAccepted = components['schemas']['RunAccepted']
/** The /ws stream envelope (exposed at GET /api/events/envelope for type-gen). */
export type ConsoleEvent = components['schemas']['ConsoleEvent']

/**
 * FacadeClient — the Layer-1 binding every kit component takes its data through
 * (never a shell-specific prop or back-channel). Methods map 1:1 to the
 * `maxim serve` facade endpoints; `on()` subscribes to the /ws event stream.
 */
export interface FacadeClient {
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
  /** GET /api/recall */
  recall(): Promise<RecallResponse>
  /** POST /api/run */
  run(request: RunRequest): Promise<RunAccepted>
  /** Subscribe to /ws events by kind; returns an unsubscribe function. */
  on(kind: string, handler: (event: ConsoleEvent) => void): () => void
}
