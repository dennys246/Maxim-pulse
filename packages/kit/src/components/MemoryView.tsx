import { useEffect, useState } from 'react'
import { useFacade } from '../facade/context'
import { FacadeError } from '../facade/http'
import type { RecallResponse } from '../facade/types'
import { Panel, Stack } from '../design/primitives'

/**
 * MemoryView — "what Maxim remembers about you" over the RECALL seam
 * (the product differentiator; reachy_mini_app.md ranks it above setup
 * polish). Renders the curated blend exactly as the facade shapes it:
 * name, player-model traits, salience-ranked story memories, and
 * confidence-gated preferences. The under-claiming lives in pymaxim
 * (provenance filter, thresholds) — this view never re-ranks or infers.
 */
type LoadState =
  | { phase: 'loading' }
  | { phase: 'loaded'; recall: RecallResponse }
  | { phase: 'unavailable'; detail: string }
  | { phase: 'error'; detail: string }

export function MemoryView() {
  const facade = useFacade()
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    let alive = true
    facade
      .recall()
      .then((recall) => {
        if (alive) setState({ phase: 'loaded', recall })
      })
      .catch((error: unknown) => {
        if (!alive) return
        if (error instanceof FacadeError && error.status === 501) {
          setState({ phase: 'unavailable', detail: error.detail })
        } else {
          setState({
            phase: 'error',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      alive = false
    }
  }, [facade])

  if (state.phase === 'loading') return <p className="text-sm text-fg-muted">Remembering…</p>
  if (state.phase === 'unavailable')
    return <p className="text-sm text-fg-muted">Memory isn’t available yet: {state.detail}</p>
  if (state.phase === 'error')
    return <p className="text-sm text-err">Couldn’t read memory: {state.detail}</p>

  const { name, player_model = [], story_memories = [], preferences = [] } = state.recall
  const empty =
    name == null &&
    player_model.length === 0 &&
    story_memories.length === 0 &&
    preferences.length === 0

  if (empty) {
    return (
      <Panel variant="bio">
        <p className="text-sm">
          Nothing yet — Maxim learns you as you talk and adventure together.
        </p>
      </Panel>
    )
  }

  return (
    <Stack className="gap-3">
      {name != null && (
        <p className="text-scene-fg">
          You’re <span className="font-medium">{name}</span>.
        </p>
      )}
      {player_model.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            How you play
          </h3>
          <p className="text-sm">{player_model.join(' · ')}</p>
        </div>
      )}
      {story_memories.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Stories we’ve shared
          </h3>
          <ul className="flex flex-col gap-1">
            {story_memories.map((memory, index) => (
              <li key={index} className="text-sm">
                {memory.summary}
                {memory.when != null && <span className="text-fg-muted"> — {memory.when}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preferences.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            What you seem to like
          </h3>
          <ul className="flex flex-col gap-1">
            {preferences.map((preference, index) => (
              <li key={index} className="text-sm">
                {preference.about}
                {preference.learned_from != null && (
                  <span className="text-fg-muted"> — from {preference.learned_from}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Stack>
  )
}
