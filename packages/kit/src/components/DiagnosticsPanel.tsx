import { useEffect, useState } from 'react'
import { useFacade } from '../facade/context'
import type { DiagnoseResponse, DiagnoseSection } from '../facade/types'

/**
 * DiagnosticsPanel — `maxim doctor` as traffic lights.
 *
 * `/api/diagnose` returns one row per check (name, status, detail, plus
 * `extra.group` and `extra.fix`); rows are grouped by `extra.group` here, with
 * failures and warnings first so a problem is visible without reading ~70
 * lines. `extra.fix` is the actionable part — it shows inline on anything not
 * OK, which is the difference between "something is wrong" and "here is what
 * to do".
 */
const TONE: Record<string, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  fail: 'text-err',
  error: 'text-err',
  info: 'text-fg-muted',
}
const GLYPH: Record<string, string> = { ok: '●', warn: '▲', fail: '✕', error: '✕', info: '·' }
const RANK: Record<string, number> = { fail: 0, error: 0, warn: 1, info: 3, ok: 2 }

const groupOf = (row: DiagnoseSection) =>
  typeof row.extra?.group === 'string' && row.extra.group !== '' ? row.extra.group : 'general'
const fixOf = (row: DiagnoseSection) =>
  typeof row.extra?.fix === 'string' && row.extra.fix !== '' ? row.extra.fix : null

export function DiagnosticsPanel() {
  const facade = useFacade()
  const [report, setReport] = useState<DiagnoseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      facade
        .diagnose()
        .then((next) => {
          if (alive) {
            setReport(next)
            setError(null)
          }
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e))
        })
    load()
    const timer = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [facade])

  if (error != null) return <p className="text-xs text-err">Couldn’t run diagnostics: {error}</p>
  if (report === null) return <p className="text-xs text-fg-muted">Checking…</p>

  const rows = report.sections ?? []
  if (rows.length === 0) return <p className="text-xs text-fg-muted">No checks reported.</p>

  const groups = new Map<string, DiagnoseSection[]>()
  for (const row of rows) {
    const key = groupOf(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const worst = (list: DiagnoseSection[]) => Math.min(...list.map((row) => RANK[row.status] ?? 2))
  const ordered = [...groups.entries()].sort((a, b) => worst(a[1]) - worst(b[1]))

  return (
    <div data-testid="diagnostics-panel" className="flex flex-col gap-2">
      {ordered.map(([group, list]) => (
        <section key={group}>
          <h4 className="text-[10px] uppercase tracking-wide text-fg-muted">{group}</h4>
          <ul className="flex flex-col gap-0.5">
            {[...list]
              .sort((a, b) => (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2))
              .map((row, index) => {
                const fix = fixOf(row)
                return (
                  <li key={index} className="text-xs">
                    <span className={TONE[row.status] ?? 'text-fg'}>
                      {GLYPH[row.status] ?? '·'} {row.name}
                    </span>
                    {row.detail != null && <span className="text-fg-muted"> — {row.detail}</span>}
                    {fix != null && row.status !== 'ok' && (
                      <span className="block pl-3 text-[10px] text-accent">↳ {fix}</span>
                    )}
                  </li>
                )
              })}
          </ul>
        </section>
      ))}
    </div>
  )
}
