import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { AuthSession, MemoryTokenStore } from '../facade/auth'
import { FacadeProvider } from '../facade/context'
import { CONTRACT_VERSION } from '../facade/contractVersion'
import { AuthError, FacadeError } from '../facade/http'
import { MockFacade } from '../facade/mock'
import { AuthGate, AuthSessionProvider } from './AuthGate'

const TOKEN = 'mxc_' + 'k'.repeat(43)

function bearerFacade() {
  const facade = new MockFacade()
  facade.greeting = { contract_version: CONTRACT_VERSION, auth: 'bearer', pairing: 'none' }
  return facade
}

function renderGate(facade: MockFacade, session: AuthSession) {
  return render(
    <AuthSessionProvider session={session}>
      <FacadeProvider facade={facade}>
        <AuthGate>
          <p>the shell</p>
        </AuthGate>
      </FacadeProvider>
    </AuthSessionProvider>,
  )
}

test('auth "none" (sandbox / mock / the Demo) renders the shell with NO login screen', async () => {
  const session = new AuthSession({ store: new MemoryTokenStore() })
  renderGate(new MockFacade(), session)
  expect(await screen.findByText('the shell')).toBeInTheDocument()
  expect(screen.queryByText('Sign in to Maxim Console')).not.toBeInTheDocument()
  expect(session.snapshot().mode).toBe('none')
})

test('bearer + no stored token → the paste screen naming --show-token; a pasted token opens the gate', async () => {
  const facade = bearerFacade()
  const session = new AuthSession({ store: new MemoryTokenStore() })
  renderGate(facade, session)
  expect(await screen.findByText('Sign in to Maxim Console')).toBeInTheDocument()
  expect(screen.getByText('maxim serve --show-token')).toBeInTheDocument()
  expect(screen.queryByText('the shell')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument() // no rotation hint on a cold load

  await userEvent.type(screen.getByLabelText('Console token'), 'nonsense{enter}')
  expect(screen.getByRole('alert')).toHaveTextContent(/doesn’t look like a console token/)

  await userEvent.clear(screen.getByLabelText('Console token'))
  await userEvent.type(
    screen.getByLabelText('Console token'),
    `http://127.0.0.1:8765/#token=${TOKEN}{enter}`,
  )
  expect(await screen.findByText('the shell')).toBeInTheDocument()
  expect(session.token()).toBe(TOKEN)
})

test('bearer + a stored token is verified with one authed read before the shell renders', async () => {
  const facade = bearerFacade()
  const identity = vi.spyOn(facade, 'identity')
  const store = new MemoryTokenStore()
  store.set(TOKEN)
  renderGate(facade, new AuthSession({ store }))
  expect(await screen.findByText('the shell')).toBeInTheDocument()
  expect(identity).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Sign in to Maxim Console')).not.toBeInTheDocument()
})

test('a stored token that 401s on verification lands on the paste screen with the rotation hint', async () => {
  const facade = bearerFacade()
  const store = new MemoryTokenStore()
  store.set(TOKEN)
  const session = new AuthSession({ store })
  facade.identity = vi.fn().mockImplementation(async () => {
    session.reject() // what HttpFacade.request does on a 401 with a held token
    throw new AuthError('Refused', '/api/identity')
  })
  renderGate(facade, session)
  expect(await screen.findByText('Sign in to Maxim Console')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(/may have been rotated/)
  expect(screen.queryByText('the shell')).not.toBeInTheDocument()
})

test('a 401 AFTER sign-in (rotation mid-session) drops back to the paste screen with the hint', async () => {
  const facade = bearerFacade()
  const store = new MemoryTokenStore()
  store.set(TOKEN)
  const session = new AuthSession({ store })
  renderGate(facade, session)
  expect(await screen.findByText('the shell')).toBeInTheDocument()

  session.reject() // the next request 401'd
  expect(await screen.findByText('Sign in to Maxim Console')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(/may have been rotated/)
  expect(screen.queryByText('the shell')).not.toBeInTheDocument()
})

test('a mismatched contract_version shows the skew banner — on the shell and on the paste screen', async () => {
  const facade = new MockFacade()
  facade.greeting = { contract_version: '9.9.9', auth: 'none', pairing: 'none' }
  renderGate(facade, new AuthSession({ store: new MemoryTokenStore() }))
  expect(await screen.findByText('the shell')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(
    `built for ${CONTRACT_VERSION}, the server speaks 9.9.9`,
  )

  const bearer = new MockFacade()
  bearer.greeting = { contract_version: '9.9.9', auth: 'bearer', pairing: 'none' }
  render(
    <AuthSessionProvider session={new AuthSession({ store: new MemoryTokenStore() })}>
      <FacadeProvider facade={bearer}>
        <AuthGate>
          <p>never</p>
        </AuthGate>
      </FacadeProvider>
    </AuthSessionProvider>,
  )
  expect(await screen.findByText('Sign in to Maxim Console')).toBeInTheDocument()
  expect(screen.getAllByRole('alert').some((el) => /speaks 9.9.9/.test(el.textContent ?? ''))).toBe(
    true,
  )
})

test('no answer from /api/hello → "isn\'t answering" with retry; a non-2xx answer → pre-0.4.0 backend', async () => {
  const down = new MockFacade()
  down.hello = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValue(down.greeting)
  renderGate(down, new AuthSession({ store: new MemoryTokenStore() }))
  expect(await screen.findByText("maxim serve isn't answering")).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('the shell')).toBeInTheDocument()

  const legacy = new MockFacade()
  legacy.hello = vi.fn().mockRejectedValue(new FacadeError(404, 'Not Found', '/api/hello'))
  render(
    <AuthSessionProvider session={new AuthSession({ store: new MemoryTokenStore() })}>
      <FacadeProvider facade={legacy}>
        <AuthGate>
          <p>never</p>
        </AuthGate>
      </FacadeProvider>
    </AuthSessionProvider>,
  )
  expect(await screen.findByText('This backend predates contract 0.4.0')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByText('never')).not.toBeInTheDocument())
})

test('a #token= fragment arriving on an already-open page (hashchange) signs in without a reload', async () => {
  const facade = bearerFacade()
  const session = new AuthSession({ store: new MemoryTokenStore() })
  renderGate(facade, session)
  expect(await screen.findByText('Sign in to Maxim Console')).toBeInTheDocument()

  window.location.hash = `#token=${TOKEN}`
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect(await screen.findByText('the shell')).toBeInTheDocument()
  expect(session.token()).toBe(TOKEN)
  expect(window.location.hash).toBe('') // stripped, never re-read or bookmarked
})
