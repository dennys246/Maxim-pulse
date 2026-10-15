import { useEffect, useState } from 'react'
import { useFacade } from '../../facade/context'
import { useEventClient } from '../../facade/eventClient'
import { useIdentity } from '../../facade/identity'
import { AuthError, FacadeError } from '../../facade/http'
import type { DegradedResponse, HealthResponse } from '../../facade/types'
import { num, when } from './format'

function problemText(error: unknown): string | null {
  if (error instanceof AuthError) return null
  if (error instanceof FacadeError) return error.detail
  return error instanceof Error ? error.message : String(error)
}

/** One human line from an allow-listed snapshot; only the fields it actually carries. */
export function summarize(snapshot: Record<string, unknown> | null | undefined): string {
  const parts: string[] = []
  const cpu = num(snapshot, 'cpu', 'usage_pct')
  const mem = num(snapshot, 'memory', 'usage_pct')
  const gpu = num(snapshot, 'gpu', 'utilization_pct')
  const temp = num(snapshot, 'gpu', 'temperature_c')
  const p50 = num(snapshot, 'lanes', 'large', 'p50_latency_ms')
  if (cpu != null) parts.push(`CPU ${Math.round(cpu)}%`)
  if (mem != null) parts.push(`RAM ${Math.round(mem)}%`)
  if (gpu != null)
    parts.push(`GPU ${Math.round(gpu)}%${temp != null ? ` ${Math.round(temp)}°C` : ''}`)
  if (p50 != null) parts.push(`LLM p50 ${Math.round(p50)} ms`)
  return parts.length > 0 ? parts.join(' · ') : 'no metrics in the latest sample'
}

const STALLS_OFF =
  'Stall detection is off on this server: no agent loop is running in this process. ' +
  'An empty list here means unknown, not healthy.'

/** A stall is a planning turn stuck past the threshold with no live LLM call (pymaxim #1279). */
function stallLine(data: Record<string, unknown> | null | undefined): string {
  const outstanding = num(data, 'outstanding_s')
  const threshold = num(data, 'threshold_s')
  const wedged = num(data, 'wedged_s')
  let line = `planning turn stuck ${outstanding != null ? Math.round(outstanding) : '?'} s`
  if (threshold != null) line += ` (threshold ${Math.round(threshold)} s)`
  line +=
    wedged != null ? `, its LLM call wedged ${Math.round(wedged)} s` : ', no LLM call in flight'
  return line
}

/** The Logs → Health tab: latest snapshot, stalls, and what the server can and cannot see. */
export function HealthTab() {
  const facade = useFacade()
  const [data, setData] = useState<HealthResponse | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    facade
      .health()
      .then((h) => alive && setData(h))
      .catch((error: unknown) => alive && setProblem(problemText(error)))
    return () => {
      alive = false
    }
  }, [facade])

  if (problem !== null) return <p className="text-sm text-err">{problem}</p>
  if (data === null) return <p className="text-sm text-fg-muted">Loading health…</p>
  return (
    <div className="flex flex-col gap-3 text-sm">
      {!data.monitoring && (
        <p className="text-fg-muted">This server is not sampling health right now.</p>
      )}
      {data.latest != null && (
        <p>
          <span className="text-fg-muted">Latest: </span>
          {summarize(data.latest)}
        </p>
      )}
      <p className="text-fg-muted">Recorded since {when(data.recorded_since)}.</p>
      {data.dropped_records > 0 && (
        <p className="text-warn">
          {data.dropped_records} health record{data.dropped_records === 1 ? '' : 's'} could not be
          saved on the server, so this history has gaps.
        </p>
      )}
      <section aria-label="Stalls">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Stalls</h3>
        {!data.stall_detection && <p className="mt-1 text-fg-muted">{STALLS_OFF}</p>}
        {data.stall_detection && (data.stalls ?? []).length === 0 && (
          <p className="mt-1">No stalls recorded.</p>
        )}
        {(data.stalls ?? []).length > 0 && (
          <ul className="mt-1">
            {(data.stalls ?? []).map((stall) => (
              <li key={stall.ts} className="border-t border-edge py-1">
                {when(stall.ts)} — {stallLine(stall.data)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** The Logs → Degraded tab: swallowed exceptions grouped by site. */
export function DegradedTab() {
  const facade = useFacade()
  const [data, setData] = useState<DegradedResponse | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    facade
      .degraded()
      .then((d) => alive && setData(d))
      .catch((error: unknown) => alive && setProblem(problemText(error)))
    return () => {
      alive = false
    }
  }, [facade])

  if (problem !== null) return <p className="text-sm text-err">{problem}</p>
  if (data === null) return <p className="text-sm text-fg-muted">Loading…</p>
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-fg-muted">
        Places where Maxim caught an error and carried on — the &ldquo;something degraded
        silently&rdquo; signal. Counted since {when(data.counted_since)}.
      </p>
      {data.sites.length === 0 ? (
        <p>Nothing has degraded.</p>
      ) : (
        <table className="w-full text-left" aria-label="Degraded sites">
          <thead className="text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="py-1 pr-2 font-medium">Site</th>
              <th className="py-1 pr-2 font-medium">Count</th>
              <th className="py-1 pr-2 font-medium">Last seen</th>
              <th className="py-1 pr-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {data.sites.map((site) => (
              <tr key={site.site} className="border-t border-edge align-top">
                <td className="py-1 pr-2 font-mono text-xs">{site.site}</td>
                <td className="py-1 pr-2">{site.count}</td>
                <td className="py-1 pr-2">{when(site.last_seen)}</td>
                <td className="py-1 pr-2 text-xs">
                  {site.exc_type ?? '—'}
                  {site.sample != null && <span className="text-fg-muted">: {site.sample}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * HealthStrip — one ambient line under the top bar: the latest host sample,
 * live from the opt-in /ws stream, seeded by GET /api/health. Renders NOTHING
 * when this server is not sampling: a strip is ambient, so absence is the
 * honest state (the Logs → Health tab explains why).
 */
export function HealthStrip() {
  const facade = useFacade()
  const hub = useEventClient()
  const { hasSeam } = useIdentity()
  const sampling = hasSeam('health')
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(
    (hub.health?.data as Record<string, unknown> | undefined) ?? null,
  )
  const [stalls, setStalls] = useState(0)

  useEffect(() => {
    if (!sampling) return
    let alive = true
    facade
      .health()
      .then((h) => {
        if (!alive) return
        if (h.latest != null) setSnapshot((prev) => prev ?? h.latest ?? null)
        setStalls((h.stalls ?? []).length)
      })
      .catch(() => {
        /* the strip is ambient: an error here is shown by the Health tab, not painted here */
      })
    const off = hub.listen((event) => {
      if (event.kind === 'health') setSnapshot((event.data as Record<string, unknown>) ?? null)
      if (event.kind === 'health_stall') setStalls((n) => n + 1)
    })
    return () => {
      alive = false
      off()
    }
  }, [facade, hub, sampling])

  if (!sampling || snapshot === null) return null
  return (
    <div
      role="status"
      aria-label="Host health"
      className="flex flex-row gap-3 border-b border-edge bg-surface px-4 py-0.5 text-xs text-fg-muted"
    >
      <span>{summarize(snapshot)}</span>
      {stalls > 0 && (
        <span className="text-warn">
          {stalls} stall{stalls === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}
