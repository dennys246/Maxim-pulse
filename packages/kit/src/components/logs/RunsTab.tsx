import { useCallback, useEffect, useState } from 'react'
import { useFacade } from '../../facade/context'
import { useStreamGaps } from '../../facade/eventClient'
import { AuthError, FacadeError } from '../../facade/http'
import type { ActionRecord, RunReport, RunSummary } from '../../facade/types'
import { CreditChip } from './CreditChip'
import { duration, usd, when } from './format'

function message(error: unknown): string | null {
  if (error instanceof AuthError) return null // the AuthGate takes over; never paint over it
  if (error instanceof FacadeError) return error.detail
  return error instanceof Error ? error.message : String(error)
}

/** Past runs, newest first; open one to see its actions in order. */
export function RunsTab() {
  const [open, setOpen] = useState<string | null>(null)
  if (open !== null) return <RunView sessionId={open} onBack={() => setOpen(null)} />
  return <RunList onOpen={setOpen} />
}

function RunList({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const facade = useFacade()
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined) // undefined = not loaded
  const [problem, setProblem] = useState<string | null>(null)
  const [showAborted, setShowAborted] = useState(false)

  const load = useCallback(
    async (from?: string) => {
      try {
        const page = await facade.listRuns(from != null ? { cursor: from } : {})
        setRuns((prev) => (from != null ? [...prev, ...page.runs] : page.runs))
        setCursor(page.next_cursor ?? null)
        setProblem(null)
      } catch (error) {
        setProblem(message(error))
        setCursor(null)
      }
    },
    [facade],
  )

  // after a stream gap a run may have started or finished unseen: reload page one
  const gaps = useStreamGaps()
  useEffect(() => {
    void load()
  }, [load, gaps])

  const aborted = runs.filter((r) => !r.has_report)
  const shown = showAborted ? runs : runs.filter((r) => r.has_report)

  if (cursor === undefined && problem === null)
    return <p className="text-sm text-fg-muted">Loading runs…</p>
  return (
    <div className="flex flex-col gap-2">
      {problem !== null && (
        <p role="alert" className="text-sm text-err">
          {problem}
        </p>
      )}
      {shown.length === 0 && problem === null && (
        <p className="text-sm text-fg-muted">No runs recorded yet.</p>
      )}
      {shown.length > 0 && (
        <table className="w-full text-left text-sm" aria-label="Past runs">
          <thead className="text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="py-1 pr-2 font-medium">Started</th>
              <th className="py-1 pr-2 font-medium">Mode</th>
              <th className="py-1 pr-2 font-medium">Outcome</th>
              <th className="py-1 pr-2 font-medium">Turns</th>
              <th className="py-1 pr-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((run) => (
              <tr key={run.session_id} className="border-t border-edge">
                <td className="py-1 pr-2">
                  <button
                    className="text-accent hover:underline"
                    onClick={() => onOpen(run.session_id)}
                    title={run.session_id}
                  >
                    {when(run.started_at)}
                  </button>
                </td>
                <td className="py-1 pr-2">{run.has_report ? (run.mode ?? '—') : 'aborted'}</td>
                <td className="py-1 pr-2">{run.finish_reason ?? '—'}</td>
                <td className="py-1 pr-2">{run.turns ?? '—'}</td>
                <td className="py-1 pr-2">{usd(run.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-row gap-2">
        {cursor != null && (
          <button className="text-sm text-accent" onClick={() => void load(cursor)}>
            Load more runs
          </button>
        )}
        {aborted.length > 0 && (
          <button className="text-sm text-fg-muted" onClick={() => setShowAborted((v) => !v)}>
            {showAborted ? 'Hide' : 'Show'} aborted runs ({aborted.length})
          </button>
        )}
      </div>
    </div>
  )
}

function RunView({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const facade = useFacade()
  const [report, setReport] = useState<RunReport | null>(null)
  const [reportProblem, setReportProblem] = useState<string | null>(null)
  const [actions, setActions] = useState<ActionRecord[]>([])
  const [actionsNote, setActionsNote] = useState<string | null>(null)
  const [formatVersion, setFormatVersion] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    facade
      .getRun(sessionId)
      .then((r) => alive && setReport(r))
      .catch((error: unknown) => {
        if (!alive) return
        setReportProblem(
          error instanceof FacadeError && error.status === 404
            ? 'This run has no report — it ended before writing one (an aborted run).'
            : message(error),
        )
      })
    return () => {
      alive = false
    }
  }, [facade, sessionId])

  const loadActions = useCallback(
    async (from?: string) => {
      try {
        const page = await facade.listActions(sessionId, from != null ? { cursor: from } : {})
        if (!page.available) {
          setActionsNote(page.reason ?? 'This run recorded no actions.')
        } else {
          setActions((prev) => (from != null ? [...prev, ...page.actions] : page.actions))
          setFormatVersion(page.format_version ?? null)
        }
        setCursor(page.next_cursor ?? null)
      } catch (error) {
        setActionsNote(message(error))
      } finally {
        setLoaded(true)
      }
    },
    [facade, sessionId],
  )

  useEffect(() => {
    void loadActions()
  }, [loadActions])

  const creditMissing = actions.length > 0 && actions.every((a) => !a.credit_recorded)

  return (
    <div className="flex flex-col gap-3">
      <button className="self-start text-sm text-accent" onClick={onBack}>
        ← All runs
      </button>
      <section aria-label="Run report">
        <h3 className="font-mono text-sm text-scene-fg">{sessionId}</h3>
        {report !== null && (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
            <dt className="text-fg-muted">Goal</dt>
            <dd>{report.goal ?? '—'}</dd>
            <dt className="text-fg-muted">Outcome</dt>
            <dd>{report.finish_reason ?? '—'}</dd>
            <dt className="text-fg-muted">Started</dt>
            <dd>{when(report.started_at)}</dd>
            <dt className="text-fg-muted">Duration</dt>
            <dd>{duration(report.duration_s)}</dd>
            <dt className="text-fg-muted">Cost</dt>
            <dd>{usd(report.cost_usd)}</dd>
          </dl>
        )}
        {reportProblem !== null && <p className="mt-1 text-sm text-fg-muted">{reportProblem}</p>}
      </section>
      <section aria-label="Actions">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Actions, in order
        </h3>
        {creditMissing && (
          <p className="mt-1 text-xs text-fg-muted">
            Per-action credit is not recorded for this run (actions format{' '}
            {formatVersion ?? 'unknown'}). Runs recorded by a pymaxim that persists credit show it
            here.
          </p>
        )}
        {!loaded && <p className="text-sm text-fg-muted">Loading actions…</p>}
        {actionsNote !== null && <p className="text-sm text-fg-muted">{actionsNote}</p>}
        {actions.length > 0 && (
          <ol className="mt-1 flex flex-col gap-1">
            {actions.map((action, i) => (
              <li
                key={i}
                className="flex flex-row flex-wrap items-center gap-2 border-t border-edge py-1 text-sm"
              >
                <span className="font-mono text-xs text-fg-muted">{i + 1}</span>
                <span className="font-mono">{action.tool ?? '—'}</span>
                <span
                  className={action.blocked ? 'text-warn' : action.success ? 'text-ok' : 'text-err'}
                >
                  {action.blocked ? 'blocked' : action.success ? 'ok' : 'failed'}
                </span>
                <CreditChip action={action} />
                {action.error != null && (
                  <span className="text-xs text-fg-muted">{action.error}</span>
                )}
              </li>
            ))}
          </ol>
        )}
        {cursor != null && (
          <button className="mt-1 text-sm text-accent" onClick={() => void loadActions(cursor)}>
            Load more actions
          </button>
        )}
      </section>
    </div>
  )
}
