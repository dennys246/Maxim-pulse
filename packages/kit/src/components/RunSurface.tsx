import { useState } from 'react'
import { useFacade } from '../facade/context'
import { FacadeError } from '../facade/http'
import type { RunAccepted, RunRequest } from '../facade/types'
import { Panel, Row, Stack } from '../design/primitives'

/**
 * RunSurface (MVP) — run a mode over the HANDLE seam (`POST /api/run`).
 * One persistent agent, mode buttons per shell config: Reachy shows
 * Adventure/Talk/Rest, the Console adds headless modes. This MVP starts a
 * run and shows the accept (session id · status); the full panel IA
 * (narrative bright / bio dim, thinking panel, DisplayExtension-style mode
 * panels over the event stream) lands with the Phase-3 api.on() bridge —
 * EventClient's transport is already in place for it.
 */
export interface RunSurfaceProps {
  /** Which modes this shell offers, in display order. */
  modes?: Array<RunRequest['mode']>
  /** Campaign path for adventure mode (shell-provided; user never types paths). */
  campaign?: string
}

type RunState =
  | { phase: 'idle' }
  | { phase: 'starting'; mode: string }
  | { phase: 'accepted'; accepted: RunAccepted }
  | { phase: 'unavailable'; detail: string }
  | { phase: 'error'; detail: string }

const MODE_LABEL: Record<string, string> = {
  adventure: '🎲 Adventure',
  talk: '💬 Talk',
  sim: '🧪 Simulation',
  rest: '😴 Rest',
}

export function RunSurface({ modes = ['adventure', 'talk', 'rest'], campaign }: RunSurfaceProps) {
  const facade = useFacade()
  const [state, setState] = useState<RunState>({ phase: 'idle' })

  const start = async (mode: RunRequest['mode']) => {
    setState({ phase: 'starting', mode })
    try {
      const accepted = await facade.run({
        mode,
        campaign: mode === 'adventure' ? (campaign ?? null) : null,
      })
      setState({ phase: 'accepted', accepted })
    } catch (error) {
      if (error instanceof FacadeError && error.status === 501) {
        setState({ phase: 'unavailable', detail: error.detail })
      } else {
        setState({ phase: 'error', detail: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  return (
    <Stack className="gap-3">
      <Row>
        {modes.map((mode) => (
          <button
            key={mode}
            className="rounded-panel border border-edge bg-scene px-3 py-2 text-sm text-scene-fg disabled:opacity-50"
            disabled={state.phase === 'starting'}
            onClick={() => void start(mode)}
          >
            {MODE_LABEL[mode] ?? mode}
          </button>
        ))}
      </Row>
      {state.phase === 'starting' && (
        <p className="text-sm text-fg-muted">Starting {MODE_LABEL[state.mode] ?? state.mode}…</p>
      )}
      {state.phase === 'accepted' && (
        <Panel variant="scene">
          <p className="text-sm">
            {MODE_LABEL[state.accepted.mode] ?? state.accepted.mode} — {state.accepted.status}
            <span className="text-fg-muted"> · run {state.accepted.session_id}</span>
          </p>
          {state.accepted.detail != null && (
            <p className="text-sm text-fg-muted">{state.accepted.detail}</p>
          )}
          <p className="mt-1 text-xs text-bio-fg">
            Live narrative + bio-activity panels arrive with the event bridge.
          </p>
        </Panel>
      )}
      {state.phase === 'unavailable' && (
        <p className="text-sm text-fg-muted">Running isn’t available yet: {state.detail}</p>
      )}
      {state.phase === 'error' && (
        <p className="text-sm text-err">Couldn’t start: {state.detail}</p>
      )}
    </Stack>
  )
}
