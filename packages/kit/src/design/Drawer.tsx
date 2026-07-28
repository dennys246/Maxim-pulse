import type { ReactNode } from 'react'

/**
 * Drawer — right-side slide-over for settings/secondary surfaces (the gear
 * drawer, memory panel). Backdrop click or ✕ closes. DesignSystem primitive.
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        data-testid="drawer-backdrop"
      />
      <aside
        role="dialog"
        aria-label={title}
        className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto border-l border-edge bg-bg p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-scene-fg">{title}</h2>
          <button
            aria-label={`Close ${title}`}
            className="rounded-panel border border-edge bg-surface px-2 py-0.5 text-sm text-fg"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {children}
      </aside>
    </div>
  )
}
