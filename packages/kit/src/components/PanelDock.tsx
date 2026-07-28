import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ConsoleEvent } from '../facade/types'
import { useEventClient } from '../facade/eventClient'

/**
 * PanelDock — the first real implementation of Maxim's DisplayExtension
 * pattern (the terminal ABC has no implementations; the archived
 * CampaignDisplay/BioStateDisplay specs carry the intent): a stable core
 * (chat/narrative) flanked by collapsible rails hosting pluggable panels.
 *
 * Activation follows pymaxim's DisplayModeTool floor semantics: events may
 * OPEN a panel, but never one the user closed — a Maxim-driven activation of
 * a user-closed panel becomes a SUGGESTION (glowing chip), and the user's
 * click is what opens it. User wins, always.
 *
 * Panel `activateOn` predicates key off event kinds — Maxim's sim_log
 * subsystem vocabulary once the EVENT seam lands; never invented UI-side.
 */
export interface PanelSpec {
  id: string
  title: string
  /** Chip glyph (emoji/character) shown on the rail strip. */
  icon: string
  side: 'left' | 'right'
  /** Event predicate for Maxim-driven activation. MUST be referentially stable. */
  activateOn?: (event: ConsoleEvent) => boolean
  render: () => ReactNode
}

interface DockState {
  open: string[]
  userClosed: string[]
  suggested: string[]
}

interface PanelDockValue {
  panels: PanelSpec[]
  state: DockState
  /** User toggle: closing records the floor; opening clears floor + suggestion. */
  toggle: (id: string) => void
}

const PanelDockContext = createContext<PanelDockValue | null>(null)

export function usePanelDock(): PanelDockValue {
  const value = useContext(PanelDockContext)
  if (value === null) {
    throw new Error('usePanelDock() requires a <PanelProvider> above this component.')
  }
  return value
}

export function PanelProvider({ panels, children }: { panels: PanelSpec[]; children: ReactNode }) {
  const hub = useEventClient()
  const [state, setState] = useState<DockState>({ open: [], userClosed: [], suggested: [] })

  useEffect(
    () =>
      hub.listen((event) => {
        for (const panel of panels) {
          if (!panel.activateOn?.(event)) continue
          setState((prev) => {
            if (prev.open.includes(panel.id) || prev.suggested.includes(panel.id)) return prev
            if (prev.userClosed.includes(panel.id)) {
              // floor semantics: suggest, never force past a user close
              return { ...prev, suggested: [...prev.suggested, panel.id] }
            }
            return { ...prev, open: [...prev.open, panel.id] }
          })
        }
      }),
    [hub, panels],
  )

  const toggle = (id: string) =>
    setState((prev) =>
      prev.open.includes(id)
        ? {
            open: prev.open.filter((panelId) => panelId !== id),
            userClosed: [...prev.userClosed, id],
            suggested: prev.suggested.filter((panelId) => panelId !== id),
          }
        : {
            open: [...prev.open, id],
            userClosed: prev.userClosed.filter((panelId) => panelId !== id),
            suggested: prev.suggested.filter((panelId) => panelId !== id),
          },
    )

  return (
    <PanelDockContext.Provider value={{ panels, state, toggle }}>
      {children}
    </PanelDockContext.Provider>
  )
}

/**
 * One rail. Renders a slim chip strip always; grows into a panel column while
 * any of its panels are open. Mount one per side around the core surface.
 */
export function PanelRail({ side }: { side: 'left' | 'right' }) {
  const { panels, state, toggle } = usePanelDock()
  const railPanels = panels.filter((panel) => panel.side === side)
  if (railPanels.length === 0) return null
  const openPanels = railPanels.filter((panel) => state.open.includes(panel.id))

  return (
    <aside
      aria-label={`${side} panel rail`}
      className={`flex min-h-0 border-edge bg-bg ${side === 'left' ? 'border-r' : 'border-l'} ${
        openPanels.length > 0 ? 'w-72' : 'w-10'
      } flex-col`}
    >
      <div className="flex flex-row justify-center gap-1 p-1">
        {railPanels.map((panel) => {
          const isOpen = state.open.includes(panel.id)
          const isSuggested = state.suggested.includes(panel.id)
          return (
            <button
              key={panel.id}
              aria-label={`${isOpen ? 'Close' : 'Open'} ${panel.title}`}
              aria-pressed={isOpen}
              title={isSuggested ? `${panel.title} — Maxim has something to show` : panel.title}
              className={`rounded-panel border px-1.5 py-1 text-sm ${
                isOpen
                  ? 'border-accent bg-scene text-scene-fg'
                  : isSuggested
                    ? 'animate-pulse border-accent bg-surface text-accent'
                    : 'border-edge bg-surface text-fg-muted'
              }`}
              onClick={() => toggle(panel.id)}
            >
              {panel.icon}
            </button>
          )
        })}
      </div>
      {openPanels.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {openPanels.map((panel) => (
            <section
              key={panel.id}
              aria-label={panel.title}
              className="flex min-h-0 flex-col rounded-panel border border-edge bg-surface"
            >
              <header className="flex items-center justify-between border-b border-edge px-2 py-1">
                <h3 className="text-xs font-semibold text-fg">{panel.title}</h3>
                <button
                  aria-label={`Close ${panel.title} panel`}
                  className="text-xs text-fg-muted hover:text-fg"
                  onClick={() => toggle(panel.id)}
                >
                  ✕
                </button>
              </header>
              <div className="min-h-0 overflow-y-auto p-2">{panel.render()}</div>
            </section>
          ))}
        </div>
      )}
    </aside>
  )
}
