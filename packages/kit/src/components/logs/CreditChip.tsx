import type { ActionRecord } from '../../facade/types'
import { signed } from './format'

/**
 * Per-action learning credit: did the tool-pain bridge book this failure, and
 * with what surprise (rpe) and pain. "Not recorded" is said in words — a run
 * whose actions file predates credit (format < 1.2) has unknown credit, never
 * zero credit, and a blank would read as zero.
 */
export function CreditChip({ action }: { action: ActionRecord }) {
  if (!action.credit_recorded) {
    return (
      <span
        className="text-xs text-fg-muted"
        title="This run's actions file predates per-action credit"
      >
        credit not recorded
      </span>
    )
  }
  const parts: string[] = []
  if (action.nac_failure_booked != null) parts.push('booked by bridge')
  if (action.rpe != null) parts.push(`rpe ${signed(action.rpe)}`)
  if (action.pain != null) parts.push(`pain ${action.pain.toFixed(2)}`)
  if (parts.length === 0) return <span className="text-xs text-fg-muted">no credit</span>
  return (
    <span
      className="rounded-panel border border-edge px-1.5 py-0.5 font-mono text-xs text-scene-fg"
      title={action.nac_failure_booked ?? undefined}
    >
      {parts.join(' · ')}
    </span>
  )
}
