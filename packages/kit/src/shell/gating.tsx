import type { ReactNode } from 'react'
import { useIdentity } from '../facade/identity'

/**
 * Seam gating, shared by every surface the shell hosts (drawers, rail panels,
 * Logs tabs). Its own module so PanelDock can gate panels without importing
 * the shell that imports PanelDock.
 */

/** Backend seams a surface needs, checked strictly against `/api/identity`. */
export interface SeamRequirement {
  /** Every name must be declared live by the backend. */
  requires?: string[]
  /** What to tell the operator when a seam is missing (an older backend). */
  missing?: string
}

/**
 * Why a surface cannot render, or null when every required seam is live.
 * A seam the server DECLARES but reports not live carries the server's own
 * reason ("closed in sandbox mode", "this server is not sampling health"); a
 * seam it does not declare at all means an older backend.
 */
function useUnmetReason(requirement: SeamRequirement): string | null {
  const { identity, hasSeam } = useIdentity()
  for (const name of requirement.requires ?? []) {
    if (hasSeam(name)) continue
    const declared = identity?.seams?.find((seam) => seam.name === name)
    if (declared?.detail != null) return declared.detail
    return (
      requirement.missing ??
      'This needs a newer Maxim backend than the one this console is talking to.'
    )
  }
  return null
}

/**
 * Renders the surface when its seams are live; otherwise says what the backend
 * needs. Never a blank panel: an operator on an older backend learns why.
 */
export function Gated({
  requirement,
  children,
}: {
  requirement: SeamRequirement
  children: ReactNode
}) {
  const reason = useUnmetReason(requirement)
  if (reason === null) return <>{children}</>
  return (
    <p role="status" className="text-sm text-fg-muted">
      {reason}
    </p>
  )
}
