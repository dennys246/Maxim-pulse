import type {
  DiagnosticReport,
  FacadeClient,
  MaximEvent,
  ModelInfo,
  ProbeResult,
  RecallSnapshot,
} from './types'

/**
 * MockFacade — the offline test double behind every kit/component test.
 * No test spins up a real robot, a real LLM, or a live `maxim serve` (CLAUDE.md);
 * components render against this instead.
 */
export class MockFacade implements FacadeClient {
  private handlers = new Map<string, Set<(event: MaximEvent) => void>>()

  diagnostic: DiagnosticReport = { placement: 'mesh-lan', healthy: true, spendMonthUsd: 0 }
  recallSnapshot: RecallSnapshot = {
    name: null,
    playerModel: [],
    storyMemories: [],
    preferences: [],
  }
  models: ModelInfo[] = [{ id: 'mock-large', provider: 'mock', curated: true }]
  writes: Array<Record<string, unknown>> = []

  async probe(target: 'mesh' | 'cloud'): Promise<ProbeResult> {
    return { ok: true, target }
  }

  async recall(): Promise<RecallSnapshot> {
    return this.recallSnapshot
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models
  }

  async diagnose(): Promise<DiagnosticReport> {
    return this.diagnostic
  }

  async writeMeshPlacement(leaderUrl: string, accessKeyRef: string): Promise<void> {
    this.writes.push({ kind: 'mesh', leaderUrl, accessKeyRef })
  }

  async writeCloudProfile(provider: string, model: string, monthlyCapUsd: number): Promise<void> {
    this.writes.push({ kind: 'cloud', provider, model, monthlyCapUsd })
  }

  on(type: string, handler: (event: MaximEvent) => void): () => void {
    const set = this.handlers.get(type) ?? new Set()
    set.add(handler)
    this.handlers.set(type, set)
    return () => set.delete(handler)
  }

  /** Test helper: push an event into the stream as `maxim serve` would. */
  emit(event: MaximEvent): void {
    this.handlers.get(event.type)?.forEach((handler) => handler(event))
  }
}
