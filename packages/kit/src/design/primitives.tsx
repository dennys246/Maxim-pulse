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

/**
 * Cmd — a command the user types into a terminal (`maxim tunnel key show`).
 * Monospace in its own colour (a hue no link or status uses) on a faint chip,
 * so instructions read as "run this" at a glance. Values the user PASTES (an
 * address template, `Key:`) stay plain `<code>`: they are not commands.
 */
export function Cmd({ children }: { children: ReactNode }) {
  return (
    <code className="whitespace-nowrap rounded-sm border border-cmd-edge bg-cmd px-1 font-mono text-cmd-fg">
      {children}
    </code>
  )
}

/** CmdBlock — a command on its own line, styled like Cmd: the one thing on screen to run. */
export function CmdBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-2 rounded-panel border border-cmd-edge bg-cmd px-3 py-2 font-mono text-sm text-cmd-fg">
      {children}
    </pre>
  )
}
