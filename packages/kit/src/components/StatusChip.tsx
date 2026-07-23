/**
 * StatusChip — "where it thinks · health · spend" in one line.
 *
 * Phase-0 skeleton: static presentation only, proving kit→both-shells
 * composition. The Phase-2 version binds to `api.diagnose` via FacadeClient
 * (see docs/plans/maxim_console.md, component inventory).
 */
export interface StatusChipProps {
  label: string
  tone?: 'ok' | 'warn' | 'err' | 'idle'
}

const toneDot = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
  idle: 'bg-fg-muted',
} as const

export function StatusChip({ label, tone = 'idle' }: StatusChipProps) {
  return (
    <span className="inline-flex items-center gap-2 rounded-panel border border-edge bg-surface px-3 py-1 text-sm text-fg">
      <span aria-hidden className={`h-2 w-2 rounded-full ${toneDot[tone]}`} />
      {label}
    </span>
  )
}
