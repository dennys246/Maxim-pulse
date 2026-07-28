import type { ConsoleEvent } from '../facade/types'
import { useEvents } from '../facade/eventClient'
import { MemoryView } from './MemoryView'
import type { PanelSpec } from './PanelDock'

/**
 * The first panel set — the terminal core's activity + thinking surfaces as
 * rail panels, plus memory as the first domain panel. Matchers are provisional
 * until the EVENT seam pins the wire vocabulary (sim_log subsystems); they are
 * module-level so identities stay stable for useEvents/activateOn.
 */

const notHeartbeat = (event: ConsoleEvent) => event.kind !== 'heartbeat'

// Provisional memory-ish kinds (terminal subsystems lowercased + api.on names).
const MEMORY_KINDS = new Set(['hippocampus', 'nac', 'learn', 'memory_capture'])
const isMemoryEvent = (event: ConsoleEvent) => MEMORY_KINDS.has(event.kind.toLowerCase())
// 'thinking' is provisional; expected to pin as 'deliberation' (sim_log
// subsystem) in the EVENT seam's v2 envelope — one-line swap on regeneration.
const isThinking = (event: ConsoleEvent) => event.kind === 'thinking'

export function ActivityPanel() {
  const events = useEvents({ match: notHeartbeat, limit: 50 })
  if (events.length === 0)
    return <p className="text-xs text-bio-fg">Quiet — activity appears as Maxim works.</p>
  return (
    <ul data-testid="activity-panel" className="flex flex-col gap-0.5">
      {events.map((event, index) => (
        <li key={index} className="font-mono text-xs text-bio-fg">
          {event.kind}
          {event.agent_id != null && ` · ${event.agent_id}`}
        </li>
      ))}
    </ul>
  )
}

export function ThinkingPanel() {
  const events = useEvents({ kinds: ['thinking'], limit: 20 })
  if (events.length === 0) return <p className="text-xs text-bio-fg">No active deliberation.</p>
  return (
    <ol data-testid="thinking-panel" className="flex flex-col gap-1">
      {events.map((event, index) => (
        <li key={index} className="text-xs text-bio-fg">
          {typeof event.data?.text === 'string' ? event.data.text : event.kind}
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
    activateOn: notHeartbeat,
    render: () => <ActivityPanel />,
  },
  {
    id: 'thinking',
    title: 'Thinking',
    icon: '💭',
    side: 'left',
    activateOn: isThinking,
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
