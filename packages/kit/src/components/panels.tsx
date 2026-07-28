import type { ConsoleEvent } from '../facade/types'
import { useEvents } from '../facade/eventClient'
import { MemoryView } from './MemoryView'
import type { PanelSpec } from './PanelDock'

/**
 * The first panel set — the terminal core's activity + thinking surfaces as
 * rail panels, plus memory as the first domain panel. Keyed to the EVENT
 * seam's v2 envelope: `tier` is the typed filter axis (server-computed;
 * unknown subsystem → "bio"); `kind` is the lowercased sim_log subsystem;
 * `message` carries the record text. Matchers are module-level so identities
 * stay stable for useEvents/activateOn.
 */

const isBioTier = (event: ConsoleEvent) => event.tier === 'bio'
const isDeliberation = (event: ConsoleEvent) => event.kind === 'deliberation'

// Memory-ish sim_log subsystems (lowercased on the wire).
const MEMORY_KINDS = new Set(['hippocampus', 'nac', 'learn'])
const isMemoryEvent = (event: ConsoleEvent) => MEMORY_KINDS.has(event.kind)

export function ActivityPanel() {
  const events = useEvents({ match: isBioTier, limit: 50 })
  if (events.length === 0)
    return <p className="text-xs text-bio-fg">Quiet — activity appears as Maxim works.</p>
  return (
    <ul data-testid="activity-panel" className="flex flex-col gap-0.5">
      {events.map((event, index) => (
        <li key={index} className="font-mono text-xs text-bio-fg">
          <span className="text-fg-muted">[{event.kind}]</span> {event.message}
          {event.agent != null && <span className="text-fg-muted"> · {event.agent}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Terminal parity: the enrichment tag icons from MaximDisplay's thinking panel. */
const TAG_ICONS: Record<string, string> = {
  hippocampus: '💾',
  nac: '🧠',
  atl: '🏷️',
  cerebellum: '🎯',
  component_index: '🗺️',
  working_memory: '📝',
  fear: '😨',
  sensory: '📡',
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * ThinkingPanel — the reasoning chain itself, not a "thoughts exist" light.
 *
 * `deliberation` records carry the reasoning in `data.text` (the counter in
 * `message` is only a cycle marker), plus which bio-systems enriched each
 * cycle (`enrichment_tags`/`enrichment_details`) — exactly the panel the
 * plans describe. Reasoning renders UNDIMMED: the terminal deliberately keeps
 * PFC subsystems (thought/deliberation) out of its bio-dim set.
 */
export function ThinkingPanel() {
  const events = useEvents({ kinds: ['deliberation'], limit: 20 })
  if (events.length === 0) return <p className="text-xs text-bio-fg">No active deliberation.</p>
  return (
    <ol data-testid="thinking-panel" className="flex flex-col gap-2">
      {events.map((event, index) => {
        const data = event.data ?? {}
        const text = typeof data.text === 'string' && data.text !== '' ? data.text : event.message
        const cycle = typeof data.cycle === 'number' ? data.cycle : null
        const maxCycles = typeof data.max_cycles === 'number' ? data.max_cycles : null
        const completed = data.completed === true
        const tags = asStrings(data.enrichment_tags)
        const details =
          typeof data.enrichment_details === 'object' && data.enrichment_details !== null
            ? (data.enrichment_details as Record<string, unknown>)
            : {}
        return (
          <li key={index} className="border-l-2 border-edge pl-2">
            <p className="text-[10px] uppercase tracking-wide text-fg-muted">
              {completed
                ? 'complete'
                : cycle != null
                  ? `cycle ${cycle}${maxCycles != null ? `/${maxCycles}` : ''}`
                  : 'thinking'}
            </p>
            <p className="whitespace-pre-wrap text-xs text-fg">{text}</p>
            {tags.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    title={typeof details[tag] === 'string' ? details[tag] : tag}
                    className="rounded-sm border border-edge px-1 text-[10px] text-bio-fg"
                  >
                    {TAG_ICONS[tag] ?? '🔬'} {tag}
                  </span>
                ))}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The default panel set shells can register (console uses all three). */
export const CORE_PANELS: PanelSpec[] = [
  {
    id: 'activity',
    title: 'Bio activity',
    icon: '🧠',
    side: 'left',
    activateOn: isBioTier,
    render: () => <ActivityPanel />,
  },
  {
    id: 'thinking',
    title: 'Thinking',
    icon: '💭',
    side: 'left',
    activateOn: isDeliberation,
    render: () => <ThinkingPanel />,
  },
  {
    id: 'memory',
    title: '✦ What Maxim remembers',
    icon: '✦',
    side: 'right',
    activateOn: isMemoryEvent,
    render: () => <MemoryView />,
  },
]
