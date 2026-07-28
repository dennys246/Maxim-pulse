import { useEffect, useState } from 'react'
import { useEventClient } from '../facade/eventClient'

/**
 * TurnStatus — the "did it freeze?" answer (dogfood finding #1): between-turn
 * LLM latency (~90s/turn) has no wire signal, so we render stream silence
 * DURING AN ACTIVE RUN as "Maxim is thinking…" with a ticking counter.
 *
 * Driven entirely by the EVENT seam's `run` meta-kind lifecycle
 * (data.status: started | ended | failed) + last-event recency; no invented
 * signals. Ended runs show their finish_reason until the next run starts —
 * which also makes host-sleep interruptions (finish_reason: cancel after a
 * long silent gap) legible instead of a mystery freeze.
 */

const THINKING_AFTER_MS = 4_000

type RunPhase =
  { phase: 'idle' } | { phase: 'running'; lastEventAt: number } | { phase: 'ended'; detail: string }

export function TurnStatus() {
  const hub = useEventClient()
  const [run, setRun] = useState<RunPhase>({ phase: 'idle' })
  const [now, setNow] = useState(() => Date.now())

  useEffect(
    () =>
      hub.listen((event) => {
        if (event.kind === 'run') {
          const status = event.data?.status
          if (status === 'started') {
            setRun({ phase: 'running', lastEventAt: Date.now() })
          } else if (status === 'ended') {
            const reason =
              typeof event.data?.finish_reason === 'string' ? event.data.finish_reason : 'done'
            setRun({ phase: 'ended', detail: `run ended · ${reason}` })
          } else if (status === 'failed') {
            const error = typeof event.data?.error === 'string' ? event.data.error : 'failed'
            setRun({ phase: 'ended', detail: `run failed · ${error}` })
          }
        } else if (event.kind !== 'heartbeat') {
          // any real event proves the turn is moving
          setRun((prev) =>
            prev.phase === 'running' ? { phase: 'running', lastEventAt: Date.now() } : prev,
          )
        }
      }),
    [hub],
  )

  useEffect(() => {
    if (run.phase !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [run.phase])

  if (run.phase === 'idle') return null
  if (run.phase === 'ended') {
    return (
      <div className="border-t border-edge bg-bio px-4 py-1">
        <p className="text-xs text-bio-fg">🎲 {run.detail}</p>
      </div>
    )
  }

  const silentSeconds = Math.floor((now - run.lastEventAt) / 1000)
  return (
    <div className="border-t border-edge bg-bio px-4 py-1" data-testid="turn-status">
      <p className="text-xs text-bio-fg">
        {silentSeconds * 1000 >= THINKING_AFTER_MS
          ? `💭 Maxim is thinking… ${silentSeconds}s`
          : '🎲 adventure in progress'}
      </p>
    </div>
  )
}
