import { useState, type FormEvent, type ReactNode } from 'react'
import { extractToken } from '../facade/auth'
import { useFacade } from '../facade/context'
import { FacadeError } from '../facade/http'

export interface LoginScreenProps {
  /** The stored token was refused — say so: it was most likely rotated. */
  rejected: boolean
  /** Receives a token that already passed the shape check. */
  onSubmit: (token: string) => void
  /**
   * The server reported `pairing: "available"` — a DEVICE deployment that can
   * speak a code (contract 0.5.0). Absent on every desktop `maxim serve`.
   */
  pairing?: boolean
  /** Rendered above the card (the contract-skew banner). */
  banner?: ReactNode
}

/**
 * LoginScreen — the sign-in screen (hardening designs A5 + A9.1).
 *
 * Two ways in, and which ones show depends on the deployment:
 *
 * 1. **Paste the token.** The desktop path. `maxim serve` prints a
 *    `/#token=<t>` URL, the shell consumes the fragment on load, and the
 *    device is signed in for good — so this screen only appears for a fresh
 *    browser, a cleared profile, or a rotated token. It names the one command
 *    that reprints the credential and accepts the bare token or the whole URL.
 * 2. **Hear a spoken code.** The DEVICE path (A9.1), offered only when
 *    `/api/hello` reports `pairing: "available"`. The robot has no screen and
 *    the Pollen dashboard cannot carry a token, so the robot SAYS a 6-digit
 *    code and this screen exchanges it. The gate is being in the room.
 *
 * Refusal copy for the pairing endpoints comes from the SERVER's `detail`
 * (pymaxim declares those shapes in the contract precisely so this screen can
 * render them) — one source of truth for wording that must match what the
 * robot just said, instead of a second copy drifting over here.
 *
 * ACCESSIBLE NAMES: neither form carries an aria-label. Both headings already
 * name their region, and a form named around its own field ("Sign in with a
 * console token" over a "Console token" input) makes the two indistinguishable
 * to any by-name lookup — a screen reader's, and a test's. Each SUBMIT button
 * says which credential it takes instead, which is what actually needs telling
 * apart when both paths are on screen.
 */
export function LoginScreen({ rejected, onSubmit, pairing = false, banner }: LoginScreenProps) {
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
        <div className="w-full max-w-md rounded-panel border border-edge bg-surface p-5">
          <h1 className="text-lg font-semibold text-scene-fg">Sign in to Maxim Console</h1>
          {rejected && (
            <p
              role="alert"
              className="mt-3 rounded-panel border border-warn bg-scene px-3 py-2 text-sm text-warn"
            >
              Your stored token was refused — it may have been rotated (
              <code className="font-mono">maxim serve --rotate-token</code>). Sign in again below.
            </p>
          )}

          {pairing && <PairingPanel onToken={onSubmit} />}

          <form onSubmit={submit}>
            {pairing && (
              <h2 className="mt-6 text-sm font-semibold text-scene-fg">
                Or paste the token yourself
              </h2>
            )}
            <p className="mt-3 text-sm text-fg-muted">
              {pairing ? (
                <>
                  On the machine running this console:{' '}
                  <code className="font-mono">maxim serve --show-token</code> prints the token.
                </>
              ) : (
                <>
                  This console is protected by a token that lives on the machine running{' '}
                  <code className="font-mono">maxim serve</code>. Open the{' '}
                  <code className="font-mono">#token=</code> link it printed at startup, or print
                  the token again with
                </>
              )}
            </p>
            {!pairing && (
              <pre className="mt-2 rounded-panel border border-edge bg-bio px-3 py-2 font-mono text-sm text-scene-fg">
                maxim serve --show-token
              </pre>
            )}
            <label className="mt-4 block text-sm text-fg-muted" htmlFor="console-token">
              Console token
            </label>
            <input
              id="console-token"
              name="token"
              autoComplete="off"
              spellCheck={false}
              autoFocus={!pairing}
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
              {/* Two ways in means two submit buttons: an ambiguous pair both
                  named "Sign in" is unusable by ear (screen reader) and by
                  test. Each says which credential it takes. */}
              {pairing ? 'Sign in with a token' : 'Sign in'}
            </button>
          </form>

          <p className="mt-4 text-xs text-fg-muted">
            Signing in is once per device: the token is kept in this browser until it is rotated.
          </p>
        </div>
      </main>
    </div>
  )
}

/** idle → listening (a code is in the air) → claiming; failures fall back. */
type PairPhase = 'idle' | 'requesting' | 'listening' | 'claiming'

/**
 * How long to wait out a paced claim (server interval is 1.5 s) before the
 * one automatic retry. See `claim()` for why retrying here is safe.
 */
const PACED_RETRY_MS = 1700

/**
 * The A9.1 spoken-code path. `POST /api/pair/request` makes the robot say a
 * code (202 — the code is never in the response, and never logged here
 * either); `POST /api/pair/claim` exchanges it for the console token, which
 * goes STRAIGHT to the AuthSession exactly as a `#token=` fragment would.
 *
 * A 410 means the code died (expired, consumed, or burned by wrong guesses),
 * so the panel returns to idle and the "say a code" button comes back —
 * a claim box the server can no longer satisfy is a dead end.
 *
 */
function PairingPanel({ onToken }: { onToken: (token: string) => void }) {
  const facade = useFacade()
  const [phase, setPhase] = useState<PairPhase>('idle')
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const describe = (error: unknown, fallback: string) =>
    error instanceof FacadeError && error.detail !== '' ? error.detail : fallback

  const ask = async () => {
    setPhase('requesting')
    setProblem(null)
    setNote(null)
    try {
      const accepted = await facade.pairRequest()
      setCode('')
      setNote(accepted.detail)
      setPhase('listening')
    } catch (error) {
      setPhase('idle')
      setProblem(describe(error, 'Could not ask the robot for a code.'))
    }
  }

  /**
   * Exchange the code. `retryPaced` allows ONE automatic retry of a 429.
   *
   * Why retrying is right here, when the rest of this flow refuses to retry:
   * elsewhere a refusal means the CREDENTIAL is dead and repeating it is the
   * silent loop the auth design forbids. A 429 is not a refusal of the code —
   * it is the server's 1.5 s claim pacing, and pymaxim deliberately does NOT
   * advance its timestamp on a paced claim, so waiting it out cannot burn one
   * of the five attempts or extend any lockout. Without this, an owner who
   * fixes a typo and resubmits quickly is told "paced" about a code that was
   * perfectly good. The retry is single and bounded; a second 429 is shown.
   */
  const exchange = async (digits: string, retryPaced: boolean): Promise<void> => {
    try {
      const result = await facade.pairClaim(digits)
      onToken(result.token) // a live credential — never logged, never in a URL
    } catch (error) {
      if (retryPaced && error instanceof FacadeError && error.status === 429) {
        setNote('Just a moment…')
        await new Promise((resolve) => setTimeout(resolve, PACED_RETRY_MS))
        return exchange(digits, false)
      }
      const gone = error instanceof FacadeError && (error.status === 410 || error.status === 409)
      setPhase(gone ? 'idle' : 'listening')
      if (gone) setNote(null)
      setProblem(describe(error, 'That code was not accepted.'))
    }
  }

  const claim = async (event: FormEvent) => {
    event.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) {
      setProblem('Enter the six digits you heard.')
      return
    }
    setPhase('claiming')
    setProblem(null)
    await exchange(digits, true)
  }

  return (
    <section aria-labelledby="pairing-title" className="mt-3">
      <h2 id="pairing-title" className="text-sm font-semibold text-scene-fg">
        Sign in by ear
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Ask the robot to say a 6-digit code out loud, then type what you hear. You have to be in the
        room.
      </p>

      {phase === 'idle' || phase === 'requesting' ? (
        <button
          type="button"
          disabled={phase === 'requesting'}
          onClick={() => void ask()}
          className="mt-3 rounded-panel border border-edge bg-scene px-3 py-1 text-sm text-accent disabled:opacity-60"
        >
          {phase === 'requesting' ? 'Asking…' : 'Have the robot say a code'}
        </button>
      ) : (
        <form onSubmit={claim}>
          <label className="mt-3 block text-sm text-fg-muted" htmlFor="pairing-code">
            Spoken code
          </label>
          <input
            id="pairing-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={16}
            autoFocus
            placeholder="123456"
            className="mt-1 w-full rounded-panel border border-edge bg-bio px-2 py-1 font-mono text-sm tracking-widest text-fg"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <div className="mt-3 flex flex-row items-center gap-2">
            <button
              type="submit"
              disabled={phase === 'claiming'}
              className="rounded-panel border border-edge bg-scene px-3 py-1 text-sm text-accent disabled:opacity-60"
            >
              {phase === 'claiming' ? 'Checking…' : 'Sign in with this code'}
            </button>
            <button
              type="button"
              onClick={() => void ask()}
              className="rounded-panel border border-edge bg-surface px-3 py-1 text-sm text-fg-muted"
            >
              Say it again
            </button>
          </div>
        </form>
      )}

      {note !== null && <p className="mt-2 text-sm text-fg-muted">{note}</p>}
      {problem !== null && (
        <p role="alert" className="mt-2 text-sm text-err">
          {problem}
        </p>
      )}
    </section>
  )
}
