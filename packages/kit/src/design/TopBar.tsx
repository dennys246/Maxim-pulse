import type { ReactNode } from 'react'

/**
 * TopBar — the shell chrome strip: status on the left, utility cluster on the
 * right (model picker, settings, external links). A DesignSystem primitive so
 * both shells share the same chrome.
 */
export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2">
      <div className="flex min-w-0 items-center gap-3">{left}</div>
      <div className="flex items-center gap-2">{right}</div>
    </header>
  )
}

/** Small icon-sized button for the TopBar utility cluster. */
export function TopBarButton({
  label,
  onClick,
  children,
}: {
  /** Accessible name (aria-label) — the visible content can be an emoji/icon. */
  label: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className="rounded-panel border border-edge bg-surface px-2 py-1 text-sm text-fg hover:text-accent"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** External link styled like a TopBarButton (docs, GitHub). */
export function TopBarLink({
  label,
  href,
  children,
}: {
  label: string
  href: string
  children: ReactNode
}) {
  return (
    <a
      aria-label={label}
      title={label}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-panel border border-edge bg-surface px-2 py-1 text-sm text-fg hover:text-accent"
    >
      {children}
    </a>
  )
}
