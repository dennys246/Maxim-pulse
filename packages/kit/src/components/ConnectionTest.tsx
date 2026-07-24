import { useCallback, useEffect, useRef, useState } from 'react'
import { useFacade } from '../facade/context'
import { FacadeError } from '../facade/http'
import type { ProbeRequest, ProbeResult } from '../facade/types'

/**
 * ConnectionTest — structured pass/fail + fix-hint over the PROBE seam
 * (maxim_console.md component inventory). The SetupWizard's "Test connection"
 * button: parent supplies the ProbeRequest from its form values; this runs the
 * probe and renders the outcome. Never hand-rolls probe logic (CLAUDE.md —
 * "Test connection" calls the PROBE seam).
 */
export interface ConnectionTestProps {
  request: ProbeRequest
  /** Notifies the parent (e.g. SetupWizard gating its Save button). */
  onResult?: (result: ProbeResult) => void
}

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'done'; result: ProbeResult }
  | { phase: 'unavailable'; detail: string }
  | { phase: 'error'; detail: string }

const statusTone = { ok: 'text-ok', warn: 'text-warn', fail: 'text-err' } as const

export function ConnectionTest({ request, onResult }: ConnectionTestProps) {
  const facade = useFacade()
  const [state, setState] = useState<TestState>({ phase: 'idle' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const runTest = useCallback(async () => {
    setState({ phase: 'testing' })
    try {
      const result = await facade.probe(request)
      if (!mounted.current) return
      setState({ phase: 'done', result })
      onResult?.(result)
    } catch (error) {
      if (!mounted.current) return
      if (error instanceof FacadeError && error.status === 501) {
        setState({ phase: 'unavailable', detail: error.detail })
      } else {
        setState({ phase: 'error', detail: error instanceof Error ? error.message : String(error) })
      }
    }
  }, [facade, request, onResult])

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          className="rounded-panel border border-edge bg-surface px-3 py-1 text-sm text-accent disabled:opacity-50"
          disabled={state.phase === 'testing'}
          onClick={() => void runTest()}
        >
          {state.phase === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      {state.phase === 'done' && (
        <p className="text-sm">
          <span className={statusTone[state.result.status]}>
            {state.result.status === 'ok' ? '✓' : state.result.status === 'warn' ? '△' : '✕'}{' '}
            {state.result.message}
          </span>
          {state.result.latency_ms != null && (
            <span className="text-fg-muted"> · {Math.round(state.result.latency_ms)} ms</span>
          )}
          {state.result.fix_hint != null && (
            <span className="block text-fg-muted">{state.result.fix_hint}</span>
          )}
        </p>
      )}
      {state.phase === 'unavailable' && (
        <p className="text-sm text-fg-muted">Connection test isn’t available yet: {state.detail}</p>
      )}
      {state.phase === 'error' && (
        <p className="text-sm text-err">Test failed to run: {state.detail}</p>
      )}
    </div>
  )
}
