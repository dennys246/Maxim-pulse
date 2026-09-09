import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { AuthSession, MemoryTokenStore, type AuthSnapshot } from '../facade/auth'
import { useFacade } from '../facade/context'
import { CONTRACT_VERSION } from '../facade/contractVersion'
import { AuthError, FacadeError } from '../facade/http'
import type { HelloResponse } from '../facade/types'
import { LoginScreen } from './LoginScreen'

/**
 * AuthSessionProvider — how a shell shares ONE AuthSession between its
 * HttpFacade (which reads the token) and the AuthGate (which collects it).
 * Optional: a shell without one (tests, the MockFacade Demo) gets a private
 * in-memory session, which is all a sandbox-shaped backend ever needs.
 */
const AuthSessionContext = createContext<AuthSession | null>(null)

let fallbackSession: AuthSession | null = null

export function AuthSessionProvider({
  session,
  children,
}: {
  session: AuthSession
  children: ReactNode
}) {
  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>
}

export function useAuthSession(): AuthSession {
  const session = useContext(AuthSessionContext)
  if (session !== null) return session
  fallbackSession ??= new AuthSession({ store: new MemoryTokenStore() })
  return fallbackSession
}

export function useAuthSnapshot(): AuthSnapshot {
  const session = useAuthSession()
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.snapshot(),
    () => session.snapshot(),
  )
}

export interface AuthGateProps {
  children: ReactNode
}

type HelloFailure = { kind: 'unreachable' | 'legacy'; detail: string }

/**
 * AuthGate — the 0.4.0 token flow, in front of the whole shell.
 *
 *   1. `GET /api/hello` first (the one tokenless surface). No answer → "maxim
 *      serve isn't answering"; a non-2xx answer → a backend that predates the
 *      contract (no /api/hello) — both blocking, both retryable. A different
 *      `contract_version` → a skew banner above the shell (the UI still runs).
 *   2. `auth: "none"` (sandbox) → straight through; NO login screen.
 *   3. `auth: "bearer"` + no stored token → the paste screen.
 *      `auth: "bearer"` + a stored token → verify it with one cheap authed
 *      read BEFORE rendering the shell, so a token rotated since the last
 *      visit lands on the paste screen with the rotation hint instead of a
 *      shell full of 401s.
 *   4. Any later 401 (or refused /ws handshake) drops the token via the
 *      session and this gate falls back to the paste screen — never a silent
 *      retry.
 *
 * Belongs INSIDE FacadeProvider (it reads the facade) and OUTSIDE everything
 * that talks to the backend (identity, events, chips) — those only mount once
 * the gate is open.
 */
export function AuthGate({ children }: AuthGateProps) {
  const facade = useFacade()
  const session = useAuthSession()
  const { token, rejected } = useAuthSnapshot()
  const [hello, setHello] = useState<HelloResponse | null>(null)
  const [helloFailure, setHelloFailure] = useState<HelloFailure | null>(null)
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null)
  const [verifyFailure, setVerifyFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = () => setAttempt((n) => n + 1)

  // The printed `/#token=<t>` link opened in a tab that already shows this
  // page is a fragment navigation — no reload, so the shell's boot-time
  // bootstrap never re-runs. Consume it here as well.
  useEffect(() => {
    const onHashChange = () => session.bootstrapFromLocation()
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [session])

  useEffect(() => {
    let alive = true
    setHello(null)
    setHelloFailure(null)
    facade
      .hello()
      .then((response) => {
        if (!alive) return
        session.setMode(response.auth)
        setHello(response)
      })
      .catch((error: unknown) => {
        if (!alive) return
        const detail = error instanceof Error ? error.message : String(error)
        // A non-2xx hello IS an answer — from a server that has no /api/hello
        // (pre-0.4.0). No answer at all is the server being down.
        setHelloFailure({ kind: error instanceof FacadeError ? 'legacy' : 'unreachable', detail })
      })
    return () => {
      alive = false
    }
  }, [facade, session, attempt])

  const needsVerify = hello?.auth === 'bearer' && token !== null && verifiedToken !== token
  useEffect(() => {
    if (!needsVerify) return
    let alive = true
    setVerifyFailure(null)
    facade
      .identity()
      .then(() => {
        if (alive) setVerifiedToken(token)
      })
      .catch((error: unknown) => {
        if (!alive) return
        // An AuthError already dropped the token via the session; the
        // snapshot flips to the paste screen with the rotation hint.
        if (error instanceof AuthError) return
        setVerifyFailure(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [facade, needsVerify, token, attempt])

  if (helloFailure !== null) {
    return helloFailure.kind === 'unreachable' ? (
      <GateNotice title="maxim serve isn't answering" onRetry={retry}>
        <p>
          Start it with <code className="font-mono">maxim serve</code> (it binds 127.0.0.1), then
          retry.
        </p>
        <p className="text-fg-muted">{helloFailure.detail}</p>
      </GateNotice>
    ) : (
      <GateNotice title="This backend predates contract 0.4.0" onRetry={retry}>
        <p>
          This UI was built for console contract {CONTRACT_VERSION}, but the server has no{' '}
          <code className="font-mono">/api/hello</code>. Upgrade pymaxim, or serve a bundle built
          for the older contract.
        </p>
        <p className="text-fg-muted">{helloFailure.detail}</p>
      </GateNotice>
    )
  }

  if (hello === null) {
    return <GateNotice title="Connecting to maxim serve…" />
  }

  const skew = hello.contract_version !== CONTRACT_VERSION ? hello.contract_version : null

  if (hello.auth === 'bearer') {
    if (token === null) {
      return (
        <LoginScreen
          rejected={rejected}
          onSubmit={(pasted) => session.setToken(pasted)}
          // A 0.4.0 server sends no `pairing` at all — `=== 'available'` is
          // the safe read, and every desktop `maxim serve` reports "none".
          pairing={hello.pairing === 'available'}
          banner={skew !== null ? <SkewBanner server={skew} /> : null}
        />
      )
    }
    if (verifiedToken !== token) {
      if (verifyFailure !== null) {
        return (
          <GateNotice title="Couldn't verify the console token" onRetry={retry}>
            <p className="text-fg-muted">{verifyFailure}</p>
          </GateNotice>
        )
      }
      return <GateNotice title="Signing in…" />
    }
  }

  return (
    <>
      {skew !== null && <SkewBanner server={skew} />}
      {children}
    </>
  )
}

/**
 * Contract skew, known BEFORE any token exists (from /api/hello). The
 * BackendChip repeats the comparison once identity is readable; this is the
 * one a tokenless visitor can see.
 */
function SkewBanner({ server }: { server: string }) {
  return (
    <div
      role="alert"
      className="border-b border-warn bg-surface px-4 py-2 text-sm text-warn"
      title="Rebuild the bundle (pnpm build) or match the pymaxim version."
    >
      ⚠ Contract mismatch — this UI was built for {CONTRACT_VERSION}, the server speaks {server}.
      Rebuild the bundle (<code className="font-mono">pnpm build</code>) or match pymaxim.
    </div>
  )
}

function GateNotice({
  title,
  onRetry,
  children,
}: {
  title: string
  onRetry?: () => void
  children?: ReactNode
}) {
  return (
    <div
      role="status"
      className="flex min-h-screen items-center justify-center bg-bg p-6 font-sans text-fg"
    >
      <div className="w-full max-w-md rounded-panel border border-edge bg-surface p-5">
        <h1 className="text-lg font-semibold text-scene-fg">{title}</h1>
        {children != null && <div className="mt-3 flex flex-col gap-2 text-sm">{children}</div>}
        {onRetry != null && (
          <button
            className="mt-4 rounded-panel border border-edge bg-scene px-3 py-1 text-sm text-accent"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
