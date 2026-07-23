import type { HTMLAttributes, ReactNode } from 'react'

function cx(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ')
}

export function PageShell({
  title,
  children,
  className,
  ...rest
}: { title?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('min-h-screen bg-bg font-sans text-fg', className)} {...rest}>
      <div className="mx-auto max-w-5xl p-6">
        {title != null && <h1 className="mb-4 text-xl font-semibold text-scene-fg">{title}</h1>}
        {children}
      </div>
    </div>
  )
}

/**
 * Panel — the MaximDisplay IA surfaces. `variant="scene"` is the bright
 * narrative/dialogue surface; `variant="bio"` is the dimmed bio-subsystem
 * activity surface rendered underneath it.
 */
export function Panel({
  variant = 'default',
  children,
  className,
  ...rest
}: {
  variant?: 'default' | 'scene' | 'bio'
  children: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  const surface = {
    default: 'bg-surface text-fg',
    scene: 'bg-scene text-scene-fg',
    bio: 'bg-bio text-bio-fg',
  }[variant]
  return (
    <div className={cx('rounded-panel border border-edge p-4', surface, className)} {...rest}>
      {children}
    </div>
  )
}

export function Stack({
  children,
  className,
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('flex flex-col gap-4', className)} {...rest}>
      {children}
    </div>
  )
}

export function Row({
  children,
  className,
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('flex flex-row items-center gap-3', className)} {...rest}>
      {children}
    </div>
  )
}
