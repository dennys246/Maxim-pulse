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

export function ThinkingPanel() {
  const events = useEvents({ kinds: ['deliberation'], limit: 20 })
  if (events.length === 0) return <p className="text-xs text-bio-fg">No active deliberation.</p>
  return (
    <ol data-testid="thinking-panel" className="flex flex-col gap-1">
      {events.map((event, index) => (
        <li key={index} className="text-xs text-bio-fg">
          {event.message}
        </li>
      ))}
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
