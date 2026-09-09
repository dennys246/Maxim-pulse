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

// ── A9.1 spoken-code pairing (contract 0.5.0) ────────────────────────────────

function pairingFacade() {
  const facade = bearerFacade()
  facade.greeting = { contract_version: CONTRACT_VERSION, auth: 'bearer', pairing: 'available' }
  return facade
}

test('a desktop backend (pairing "none") offers ONLY the paste path', async () => {
  renderGate(bearerFacade(), new AuthSession({ store: new MemoryTokenStore() }))
  expect(await screen.findByText('Sign in to Maxim Console')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Have the robot say a code' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('maxim serve --show-token')).toBeInTheDocument()
})

test('a device backend pairs by ear: ask → the robot speaks → the code signs in', async () => {
  const facade = pairingFacade()
  const session = new AuthSession({ store: new MemoryTokenStore() })
  renderGate(facade, session)
  await userEvent.click(await screen.findByRole('button', { name: 'Have the robot say a code' }))

  // the 202 copy comes from the server, so it matches what the robot just said
  expect(await screen.findByText(/speaking a 6-digit code/)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Spoken code'), facade.pairCode)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in with this code' }))

  expect(await screen.findByText('the shell')).toBeInTheDocument()
  expect(session.token()).toBe(facade.pairToken) // stored exactly as a #token= would be
  expect(facade.requests.map((r) => r.endpoint)).toEqual(['/api/pair/request', '/api/pair/claim'])
})

test('a wrong code keeps the claim box open and shows the server’s reason', async () => {
  const facade = pairingFacade()
  renderGate(facade, new AuthSession({ store: new MemoryTokenStore() }))
  await userEvent.click(await screen.findByRole('button', { name: 'Have the robot say a code' }))
  await userEvent.type(await screen.findByLabelText('Spoken code'), '000000')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in with this code' }))

  expect(await screen.findByText('Wrong code.')).toBeInTheDocument()
  expect(screen.getByLabelText('Spoken code')).toBeInTheDocument() // still claimable
  expect(screen.queryByText('the shell')).not.toBeInTheDocument()
})

test('a dead code (410) drops back to asking — a claim box the server cannot satisfy is a dead end', async () => {
  const facade = pairingFacade()
  facade.pairClaim = vi
    .fn()
    .mockRejectedValue(
      new FacadeError(
        410,
        'No active pairing code — ask the robot to speak one.',
        '/api/pair/claim',
      ),
    )
  renderGate(facade, new AuthSession({ store: new MemoryTokenStore() }))
  await userEvent.click(await screen.findByRole('button', { name: 'Have the robot say a code' }))
  await userEvent.type(await screen.findByLabelText('Spoken code'), '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in with this code' }))

  expect(await screen.findByText(/No active pairing code/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Have the robot say a code' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Spoken code')).not.toBeInTheDocument()
})

test('a 429 on the announce (a LAN prankster, or an impatient owner) keeps the ask button', async () => {
  const facade = pairingFacade()
  facade.pairRequest = vi
    .fn()
    .mockRejectedValue(
      new FacadeError(
        429,
        'A code was just announced — listen, or retry shortly.',
        '/api/pair/request',
      ),
    )
  renderGate(facade, new AuthSession({ store: new MemoryTokenStore() }))
  await userEvent.click(await screen.findByRole('button', { name: 'Have the robot say a code' }))

  expect(await screen.findByText(/just announced/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Have the robot say a code' })).toBeEnabled()
  expect(screen.queryByLabelText('Spoken code')).not.toBeInTheDocument()
})

test('a short code is refused client-side without spending a server attempt', async () => {
  const facade = pairingFacade()
  const claim = vi.spyOn(facade, 'pairClaim')
  renderGate(facade, new AuthSession({ store: new MemoryTokenStore() }))
  await userEvent.click(await screen.findByRole('button', { name: 'Have the robot say a code' }))
  await userEvent.type(await screen.findByLabelText('Spoken code'), '123')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in with this code' }))

  expect(await screen.findByText('Enter the six digits you heard.')).toBeInTheDocument()
  expect(claim).not.toHaveBeenCalled() // 5 wrong attempts burn the code — don't waste one
})

test('the token from a claim never reaches the DOM', async () => {
  const facade = pairingFacade()
  const { container } = renderGate(facade, new AuthSession({ store: new MemoryTokenStore() }))
  await userEvent.click(await screen.findByRole('button', { name: 'Have the robot say a code' }))
  await userEvent.type(await screen.findByLabelText('Spoken code'), facade.pairCode)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in with this code' }))
  expect(await screen.findByText('the shell')).toBeInTheDocument()
  expect(container.innerHTML).not.toContain(facade.pairToken)
})
