import type { ReactNode } from 'react'
import type { PanelSpec } from '../components/PanelDock'
import type { SubscribeFrame } from '../facade/types'

/**
 * One console, many devices (docs/plans/log_explorer.md §7).
 *
 * The kit owns the shell — auth, the provider stack, the top bar, the chat
 * core, rails and drawers. A DEVICE is a profile: data saying which of those
 * pieces it shows. A fix to the shell lands once for every device; a new
 * device is a new profile, not a new copy of the shell.
 *
 * What renders is the profile ∩ the backend's seams: anything with `requires`
 * checks `/api/identity` strictly, so a backend that predates a surface (or a
 * device whose backend lacks it) gets an explanation, never a blank panel or a
 * call to an endpoint that is not there.
 *
 * The bundle boundary stays mechanical: a profile lives in its APP, so a device
 * bundle contains only what its profile imports. Heavy surfaces live behind
 * `@maxim/kit/viz` and are lazy-loaded; `pnpm size:reachy` keeps guarding the
 * robot.
 */

/** Backend seams a surface needs, checked strictly against `/api/identity`. */
export interface SeamRequirement {
  /** Every name must be declared live by the backend. */
  requires?: string[]
  /** What to tell the operator when a seam is missing (an older backend). */
  missing?: string
}

/** A button in the top bar's utility cluster. */
export interface TopBarAction extends SeamRequirement {
  id: string
  /** Accessible name; also the tooltip. */
  label: string
  /** The visible glyph. A function renders as a component, so it may use hooks. */
  content: ReactNode | (() => ReactNode)
  /** Click opens this drawer (toggling it shut if already open)... */
  opens?: string
  /** ...or toggles this rail panel. */
  togglesPanel?: string
}

export interface DrawerSpec extends SeamRequirement {
  id: string
  title: string
  /** Table-shaped surfaces (Logs) get the wide drawer. */
  wide?: boolean
  render: (close: () => void) => ReactNode
}

export interface LinkSpec {
  label: string
  href: string
  content: ReactNode
}

export interface DeviceProfile {
  /** Stable id: 'console', 'reachy', … */
  id: string
  /**
   * Server-side /ws filter. A device that renders no bio-tier surface should
   * subscribe at `{ tier: 'clean' }` — the difference between a comfortable
   * and a busy socket on a Pi.
   */
  subscribe?: SubscribeFrame
  /** Rail panels this device offers (the user's placement is remembered). */
  panels: PanelSpec[]
  /** Which rails exist. */
  rails: { left: boolean; right: boolean }
  /** Top-bar utility buttons, in order; links follow them. */
  actions: TopBarAction[]
  links: LinkSpec[]
  drawers: DrawerSpec[]
  /**
   * Show the host health strip and ask the server for the live health stream
   * (contract 0.6.0). The opt-in is sent only once the connection's identity
   * declares the `health` seam live — an older server would read it as a
   * filter and starve the stream.
   */
  health?: boolean
}
