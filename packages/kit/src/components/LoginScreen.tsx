import { useState, type FormEvent, type ReactNode } from 'react'
import { extractToken } from '../facade/auth'

export interface LoginScreenProps {
  /** The stored token was refused — say so: it was most likely rotated. */
  rejected: boolean
  /** Receives a token that already passed the shape check. */
  onSubmit: (token: string) => void
  /** Rendered above the card (the contract-skew banner). */
  banner?: ReactNode
}

/**
 * LoginScreen — the paste-token screen (hardening design A5).
 *
 * The normal path never shows it: `maxim serve` prints a `/#token=<t>` URL,
 * the shell consumes the fragment on load, and the device is signed in for
 * good. This screen is for the other paths — a fresh browser, a cleared
 * profile, or a rotated token — and names the one command that reprints the
 * credential. It accepts either the bare token or the whole printed URL.
 */
export function LoginScreen({ rejected, onSubmit, banner }: LoginScreenProps) {
  const [value, setValue] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const token = extractToken(value)
    if (token === null) {
      setProblem(
        'That doesn’t look like a console token (mxc_ followed by 43 characters). Paste the token itself or the whole printed URL.',
      )
      return
    }
    setProblem(null)
    onSubmit(token)
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg font-sans text-fg">
      {banner}
      <main className="flex flex-1 items-center justify-center p-6">
        <form
          onSubmit={submit}
          aria-labelledby="login-title"
          className="w-full max-w-md rounded-panel border border-edge bg-surface p-5"
        >
          <h1 id="login-title" className="text-lg font-semibold text-scene-fg">
            Sign in to Maxim Console
          </h1>
          {rejected && (
            <p
              role="alert"
              className="mt-3 rounded-panel border border-warn bg-scene px-3 py-2 text-sm text-warn"
            >
              Your stored token was refused — it may have been rotated (
              <code className="font-mono">maxim serve --rotate-token</code>). Paste the current one.
            </p>
          )}
          <p className="mt-3 text-sm text-fg-muted">
            This console is protected by a token that lives on the machine running{' '}
            <code className="font-mono">maxim serve</code>. Open the{' '}
            <code className="font-mono">#token=</code> link it printed at startup, or print the
            token again with
          </p>
          <pre className="mt-2 rounded-panel border border-edge bg-bio px-3 py-2 font-mono text-sm text-scene-fg">
            maxim serve --show-token
          </pre>
          <label className="mt-4 block text-sm text-fg-muted" htmlFor="console-token">
            Console token
          </label>
          <input
            id="console-token"
            name="token"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            placeholder="mxc_…  (or paste the printed URL)"
            className="mt-1 w-full rounded-panel border border-edge bg-bio px-2 py-1 font-mono text-sm text-fg"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {problem !== null && (
            <p role="alert" className="mt-2 text-sm text-err">
              {problem}
            </p>
          )}
          <button
            type="submit"
            className="mt-4 rounded-panel border border-edge bg-scene px-3 py-1 text-sm text-accent"
          >
            Sign in
          </button>
          <p className="mt-4 text-xs text-fg-muted">
            Signing in is once per device: the token is kept in this browser until it is rotated.
          </p>
        </form>
      </main>
    </div>
  )
}
