import { useEffect, useState } from 'react'
import { useFacade } from '../facade/context'
import type { DiagnoseResponse } from '../facade/types'
import { StatusChip } from './StatusChip'

/**
 * LiveStatusChip — StatusChip bound to `api.diagnose` ("where it thinks ·
 * health", maxim_console.md inventory). Renders the structured platform +
 * worst section status; refreshes on an interval. Spend joins the line when
 * diagnose carries it (per-section `extra` today).
 */
export function LiveStatusChip({ refreshMs = 30_000 }: { refreshMs?: number }) {
  const facade = useFacade()
  const [report, setReport] = useState<DiagnoseResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => {
      facade
        .diagnose()
        .then((r) => {
          if (alive) {
            setReport(r)
            setFailed(false)
          }
        })
        .catch(() => {
          if (alive) setFailed(true)
        })
    }
    load()
    const timer = setInterval(load, refreshMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [facade, refreshMs])

  if (failed) return <StatusChip label="maxim serve unreachable" tone="err" />
  if (report === null) return <StatusChip label="checking…" tone="idle" />

  const sections = report.sections ?? []
  const worst = sections.some((s) => s.status === 'error' || s.status === 'fail')
    ? 'err'
    : sections.some((s) => s.status === 'warn')
      ? 'warn'
      : 'ok'
  const where =
    report.platform != null ? `${report.platform.os}/${report.platform.arch}` : 'unknown'
  const placement = sections.find((s) => s.name === 'placement')?.detail
  return <StatusChip label={placement != null ? `${placement} · ${where}` : where} tone={worst} />
}
