import { useEffect, useState } from 'react'
import { useFacade } from '../facade/context'
import { FacadeError } from '../facade/http'
import type { ModelInfo, ModelsResponse } from '../facade/types'

/**
 * ModelPicker — curated + full profile list over `api.list_models`
 * (maxim_console.md component inventory). Groups come straight from the
 * facade (`ModelsResponse.groups`); each group shows the first few profiles
 * with the rest behind "Show all" (the wizard's curated-vs-Advanced split).
 * The wire contract has no curated marker yet — collapse-by-count stands in
 * until pymaxim adds one (flagged).
 */
export interface ModelPickerProps {
  /** Selected profile name. */
  value?: string
  onChange?: (model: ModelInfo) => void
  /** Show only matching profiles (e.g. cloud-only for the cloud setup path). */
  filter?: (model: ModelInfo) => boolean
  /** Profiles shown per group before "Show all". */
  curatedCount?: number
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'loaded'; models: ModelsResponse }
  | { phase: 'unavailable'; detail: string }
  | { phase: 'error'; detail: string }

export function ModelPicker({ value, onChange, filter, curatedCount = 3 }: ModelPickerProps) {
  const facade = useFacade()
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    facade
      .listModels()
      .then((models) => {
        if (alive) setState({ phase: 'loaded', models })
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

  if (state.phase === 'loading') return <p className="text-sm text-fg-muted">Loading models…</p>
  if (state.phase === 'unavailable')
    return <p className="text-sm text-fg-muted">Model list isn’t available yet: {state.detail}</p>
  if (state.phase === 'error')
    return <p className="text-sm text-err">Couldn’t load models: {state.detail}</p>

  const groups = Object.entries(state.models.groups)
    .map(([group, models]) => [group, filter ? models.filter(filter) : models] as const)
    .filter(([, models]) => models.length > 0)

  if (groups.length === 0) return <p className="text-sm text-fg-muted">No models available.</p>

  return (
    <div className="flex flex-col gap-3">
      {groups.map(([group, models]) => {
        const isExpanded = expanded.has(group)
        const shown = isExpanded ? models : models.slice(0, curatedCount)
        return (
          <div key={group}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {group}
            </h3>
            <ul className="flex flex-col gap-1" role="listbox" aria-label={`${group} models`}>
              {shown.map((model) => (
                <li key={model.name}>
                  <button
                    role="option"
                    aria-selected={model.name === value}
                    className={`w-full rounded-panel border px-2 py-1 text-left text-sm ${
                      model.name === value
                        ? 'border-accent bg-scene text-scene-fg'
                        : 'border-edge bg-surface text-fg'
                    }`}
                    onClick={() => onChange?.(model)}
                  >
                    {model.name}
                    <span className="float-right text-xs text-fg-muted">
                      {model.cloud ? 'cloud' : model.backend}
                      {model.context_length != null &&
                        ` · ${Math.round(model.context_length / 1024)}k ctx`}
                      {model.ready && ' · ready'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {models.length > curatedCount && (
              <button
                className="mt-1 text-xs text-accent"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (isExpanded) next.delete(group)
                    else next.add(group)
                    return next
                  })
                }
              >
                {isExpanded ? 'Show fewer' : `Show all ${models.length}`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
