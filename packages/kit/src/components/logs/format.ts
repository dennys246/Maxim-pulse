/** Small, dependency-free formatters shared by the Logs surfaces. */

export function when(epoch: number | null | undefined): string {
  if (epoch == null) return '—'
  return new Date(epoch * 1000).toLocaleString()
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${Math.round(seconds)} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s === 0 ? `${m} min` : `${m} min ${s} s`
}

export function usd(value: number | null | undefined): string {
  if (value == null) return '—'
  return value === 0 ? '$0' : `$${value.toFixed(value < 0.01 ? 4 : 2)}`
}

export function signed(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`
}

/** Read a number at `path` from an untyped snapshot; null when absent or not a number. */
export function num(
  snapshot: Record<string, unknown> | null | undefined,
  ...path: string[]
): number | null {
  let cur: unknown = snapshot
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[key]
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null
}
