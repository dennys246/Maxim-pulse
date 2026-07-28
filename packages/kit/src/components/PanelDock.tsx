import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ConsoleEvent } from '../facade/types'
import { useEventClient } from '../facade/eventClient'

/**
 * PanelDock — the first real implementation of Maxim's DisplayExtension
 * pattern (the terminal ABC has no implementations; the archived
 * CampaignDisplay/BioStateDisplay specs carry the intent): a stable core
 * (chat/narrative) flanked by collapsible rails hosting pluggable panels.
 *
 * The layout belongs to the USER: rails and panels resize by drag or keyboard,
 * chips drag between rails and reorder, and the whole arrangement persists.
 * Activation follows pymaxim's DisplayModeTool floor semantics: events may
 * OPEN a panel, but never one the user closed — that becomes a SUGGESTION
 * (glowing chip) instead. User wins, always.
 *
 * Panel `activateOn` predicates key off the EVENT seam's vocabulary (sim_log
 * subsystems / tier), never kinds invented UI-side.
 *
 * No drag/grid dependency by design: a library here would enter the lean kit
 * entry and thus the Reachy on-device bundle (AGENTS.md § code-split).
 */
export interface PanelSpec {
  id: string
  title: string
  /** Chip glyph (emoji/character) shown on the rail strip. */
  icon: string
  /** Default rail; the user's own placement overrides it. */
  side: 'left' | 'right'
  /** Event predicate for Maxim-driven activation. MUST be referentially stable. */
  activateOn?: (event: ConsoleEvent) => boolean
  render: () => ReactNode
}

type Side = 'left' | 'right'

const RAIL_COLLAPSED_PX = 40
const RAIL_MIN_PX = 180
const RAIL_MAX_PX = 640
const RAIL_DEFAULT_PX = 288
const PANEL_MIN_PX = 96
const PANEL_MAX_PX = 900
const PANEL_DEFAULT_PX = 220
const RESIZE_STEP_PX = 16
const STORAGE_KEY = 'maxim-pulse:panel-layout'

interface Layout {
  /** User placement overrides (falls back to PanelSpec.side). */
  side: Record<string, Side>
  /** User ordering; ids not listed keep registry order, appended. */
  order: string[]
  railWidth: Record<Side, number>
  panelHeight: Record<string, number>
}

const DEFAULT_LAYOUT: Layout = {
  side: {},
  order: [],
  railWidth: { left: RAIL_DEFAULT_PX, right: RAIL_DEFAULT_PX },
  panelHeight: {},
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Where the user's layout persists. Injected so the kit never assumes a browser global. */
export interface LayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): LayoutStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // storage blocked (private mode / sandboxed frame)
  }
}

function loadLayout(storage: LayoutStorage | null): Layout {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (raw == null) return DEFAULT_LAYOUT
    const saved = JSON.parse(raw) as Partial<Layout>
    return {
      ...DEFAULT_LAYOUT,
      ...saved,
      railWidth: { ...DEFAULT_LAYOUT.railWidth, ...saved.railWidth },
    }
  } catch {
    return DEFAULT_LAYOUT // corrupt/unavailable storage is never fatal
  }
}

interface DockState {
  open: string[]
  userClosed: string[]
  suggested: string[]
}

interface PanelDockValue {
  panels: PanelSpec[]
  state: DockState
  layout: Layout
  toggle: (id: string) => void
  /** Panels belonging to a rail, in user order. */
  panelsFor: (side: Side) => PanelSpec[]
  /** Move a panel to a rail, optionally inserting before another panel. */
  movePanel: (id: string, side: Side, beforeId?: string) => void
  setRailWidth: (side: Side, px: number) => void
  setPanelHeight: (id: string, px: number) => void
}

const PanelDockContext = createContext<PanelDockValue | null>(null)

export function usePanelDock(): PanelDockValue {
  const value = useContext(PanelDockContext)
  if (value === null) {
    throw new Error('usePanelDock() requires a <PanelProvider> above this component.')
  }
  return value
}

export function PanelProvider({
  panels,
  storage,
  children,
}: {
  panels: PanelSpec[]
  /** Defaults to localStorage when available; pass a fake in tests. */
  storage?: LayoutStorage | null
  children: ReactNode
}) {
  const hub = useEventClient()
  const [state, setState] = useState<DockState>({ open: [], userClosed: [], suggested: [] })
  const storeRef = useRef<LayoutStorage | null>(null)
  if (!storeRef.current) storeRef.current = storage ?? browserStorage()
  const [layout, setLayout] = useState<Layout>(() => loadLayout(storeRef.current))

  useEffect(() => {
    try {
      storeRef.current?.setItem(STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // storage full/blocked — layout just won't persist
    }
  }, [layout])

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

  const panelsFor = (side: Side) => {
    const mine = panels.filter((panel) => (layout.side[panel.id] ?? panel.side) === side)
    const rank = (id: string) => {
      const index = layout.order.indexOf(id)
      return index === -1 ? Number.MAX_SAFE_INTEGER : index
    }
    return [...mine].sort((a, b) => rank(a.id) - rank(b.id))
  }

  const movePanel = (id: string, side: Side, beforeId?: string) => {
    if (id === beforeId) return
    setLayout((prev) => {
      const known = prev.order.length > 0 ? prev.order : panels.map((panel) => panel.id)
      const without = known.filter((panelId) => panelId !== id)
      const at = beforeId != null ? without.indexOf(beforeId) : -1
      const order =
        at === -1 ? [...without, id] : [...without.slice(0, at), id, ...without.slice(at)]
      return { ...prev, side: { ...prev.side, [id]: side }, order }
    })
  }

  const setRailWidth = (side: Side, px: number) =>
    setLayout((prev) => ({
      ...prev,
      railWidth: { ...prev.railWidth, [side]: clamp(px, RAIL_MIN_PX, RAIL_MAX_PX) },
    }))

  const setPanelHeight = (id: string, px: number) =>
    setLayout((prev) => ({
      ...prev,
      panelHeight: { ...prev.panelHeight, [id]: clamp(px, PANEL_MIN_PX, PANEL_MAX_PX) },
    }))

  return (
    <PanelDockContext.Provider
      value={{ panels, state, layout, toggle, panelsFor, movePanel, setRailWidth, setPanelHeight }}
    >
      {children}
    </PanelDockContext.Provider>
  )
}

/**
 * One rail. Chips stack VERTICALLY while collapsed (a narrow edge strip) and
 * flow HORIZONTALLY, wrapping line by line, once the rail opens. Drag a chip
 * to another rail or onto another chip to reorder.
 */
export function PanelRail({ side }: { side: Side }) {
  const { state, layout, toggle, panelsFor, movePanel, setRailWidth, setPanelHeight } =
    usePanelDock()
  const railPanels = panelsFor(side)
  const openPanels = railPanels.filter((panel) => state.open.includes(panel.id))
  const expanded = openPanels.length > 0
  const width = expanded ? layout.railWidth[side] : RAIL_COLLAPSED_PX

  const acceptDrop = (event: React.DragEvent, beforeId?: string) => {
    event.preventDefault()
    event.stopPropagation()
    const id = event.dataTransfer.getData('text/plain')
    if (id !== '') movePanel(id, side, beforeId)
  }

  const startRailDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = layout.railWidth[side]
    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX
      setRailWidth(side, startWidth + (side === 'left' ? delta : -delta))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startPanelDrag = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = layout.panelHeight[id] ?? PANEL_DEFAULT_PX
    const onMove = (move: PointerEvent) => setPanelHeight(id, startHeight + (move.clientY - startY))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (railPanels.length === 0 && !expanded) {
    // still a drop target, so an emptied rail can be refilled by dragging
    return (
      <div
        aria-label={`${side} panel rail`}
        className={`w-2 shrink-0 bg-bg ${side === 'left' ? 'border-r' : 'border-l'} border-edge`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => acceptDrop(event)}
      />
    )
  }

  return (
    <aside
      aria-label={`${side} panel rail`}
      style={{ width }}
      className={`flex min-h-0 shrink-0 border-edge bg-bg ${
        side === 'left' ? 'flex-row border-r' : 'flex-row-reverse border-l'
      }`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => acceptDrop(event)}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* chip strip: vertical while collapsed, horizontal + wrapping when open */}
        <div
          data-testid={`${side}-rail-chips`}
          className={`flex gap-1 p-1 ${expanded ? 'flex-row flex-wrap' : 'flex-col items-center'}`}
        >
          {railPanels.map((panel) => {
            const isOpen = state.open.includes(panel.id)
            const isSuggested = state.suggested.includes(panel.id)
            return (
              <button
                key={panel.id}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/plain', panel.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => acceptDrop(event, panel.id)}
                aria-label={`${isOpen ? 'Close' : 'Open'} ${panel.title}`}
                aria-pressed={isOpen}
                title={
                  isSuggested
                    ? `${panel.title} — Maxim has something to show (drag to move)`
                    : `${panel.title} (drag to move)`
                }
                className={`cursor-grab rounded-panel border px-1.5 py-1 text-sm active:cursor-grabbing ${
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

        {expanded && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {openPanels.map((panel) => (
              <section
                key={panel.id}
                aria-label={panel.title}
                style={{ height: layout.panelHeight[panel.id] ?? PANEL_DEFAULT_PX }}
                className="flex shrink-0 flex-col rounded-panel border border-edge bg-surface"
              >
                <header className="flex shrink-0 items-center justify-between border-b border-edge px-2 py-1">
                  <h3 className="text-xs font-semibold text-fg">{panel.title}</h3>
                  <button
                    aria-label={`Close ${panel.title} panel`}
                    className="text-xs text-fg-muted hover:text-fg"
                    onClick={() => toggle(panel.id)}
                  >
                    ✕
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">{panel.render()}</div>
                <div
                  role="separator"
                  aria-label={`Resize ${panel.title} panel`}
                  aria-orientation="horizontal"
                  tabIndex={0}
                  className="h-1.5 shrink-0 cursor-row-resize rounded-b-panel bg-edge hover:bg-accent"
                  onPointerDown={(event) => startPanelDrag(event, panel.id)}
                  onKeyDown={(event) => {
                    const current = layout.panelHeight[panel.id] ?? PANEL_DEFAULT_PX
                    if (event.key === 'ArrowDown')
                      setPanelHeight(panel.id, current + RESIZE_STEP_PX)
                    if (event.key === 'ArrowUp') setPanelHeight(panel.id, current - RESIZE_STEP_PX)
                  }}
                />
              </section>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div
          role="separator"
          aria-label={`Resize ${side} rail`}
          aria-orientation="vertical"
          tabIndex={0}
          className="w-1.5 shrink-0 cursor-col-resize bg-edge hover:bg-accent"
          onPointerDown={startRailDrag}
          onKeyDown={(event) => {
            const current = layout.railWidth[side]
            const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
            const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
            if (event.key === grow) setRailWidth(side, current + RESIZE_STEP_PX)
            if (event.key === shrink) setRailWidth(side, current - RESIZE_STEP_PX)
          }}
        />
      )}
    </aside>
  )
}
