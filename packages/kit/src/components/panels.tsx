import { useState } from 'react'
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

/**
 * Collapse CONSECUTIVE identical records into one row with a count. Producers
 * legitimately repeat (a percept is logged by the factory and again by each
 * source; session-end flushes 50 near-identical promotions in ~10ms), and a
 * one-per-line log buries the signal. Nothing is hidden — the count says how
 * many arrived.
 */
function collapseRepeats(events: ConsoleEvent[]): Array<{ event: ConsoleEvent; count: number }> {
  const rows: Array<{ event: ConsoleEvent; count: number }> = []
  for (const event of events) {
    const last = rows[rows.length - 1]
    if (last != null && last.event.kind === event.kind && last.event.message === event.message) {
      last.count += 1
    } else {
      rows.push({ event, count: 1 })
    }
  }
  return rows
}

/**
 * ActivityPanel — the bio-subsystem log, with per-kind muting.
 *
 * Muting exists because the idle loop is LOUD: between turns the agent emits a
 * hippocampus/scn pair about twice a second, which floods any fixed window and
 * flushes out the records that matter (a tool call, an NAc update). The two
 * kinds alternate, so consecutive-collapse can't help — filtering can. This
 * mirrors the terminal display's own channel filtering rather than inventing a
 * cleverer heuristic: the user decides what's noise, and the chip keeps showing
 * the count so nothing disappears without saying so.
 */
export function ActivityPanel() {
  const events = useEvents({ match: isBioTier, limit: 200 })
  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set())

  if (events.length === 0)
    return <p className="text-xs text-bio-fg">Quiet — activity appears as Maxim works.</p>

  const counts = new Map<string, number>()
  for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
  const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const visible = events.filter((event) => !muted.has(event.kind))

  const toggle = (kind: string) =>
    setMuted((prev) => {
      const next = new Set(prev)
      if (!next.delete(kind)) next.add(kind)
      return next
    })

  return (
    <div className="flex flex-col gap-1">
      <div data-testid="activity-kinds" className="flex flex-wrap gap-1">
        {kinds.map(([kind, count]) => {
          const isMuted = muted.has(kind)
          return (
            <button
              key={kind}
              aria-label={`${isMuted ? 'Show' : 'Mute'} ${kind}`}
              aria-pressed={!isMuted}
              title={isMuted ? `${kind} hidden — click to show` : `Hide ${kind}`}
              className={`rounded-sm border px-1 font-mono text-[10px] ${
                isMuted
                  ? 'border-edge text-fg-muted line-through opacity-60'
                  : 'border-edge text-bio-fg'
              }`}
              onClick={() => toggle(kind)}
            >
              {kind} ×{count}
            </button>
          )
        })}
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-fg-muted">Everything here is muted.</p>
      ) : (
        <ul data-testid="activity-panel" className="flex flex-col gap-0.5">
          {collapseRepeats(visible).map(({ event, count }, index) => (
            <li key={index} className="font-mono text-xs text-bio-fg">
              <span className="text-fg-muted">[{event.kind}]</span> {event.message}
              {event.agent != null && <span className="text-fg-muted"> · {event.agent}</span>}
              {count > 1 && <span className="ml-1 text-fg-muted">×{count}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
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
