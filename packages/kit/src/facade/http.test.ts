import { vi } from 'vitest'
import { AuthSession, MemoryTokenStore, WS_APP_SUBPROTOCOL } from './auth'
import { WsEventSource, type WsLike } from './events'
import { wireEvent } from './mock'
import { AuthError, FacadeError, HttpFacade } from './http'
import type { ConsoleEvent } from './types'

const TOKEN = 'mxc_' + 't'.repeat(43)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

class FakeWs implements WsLike {
  static instances: FakeWs[] = []
  sent: string[] = []
  onopen: (() => void) | null = null
  send(data: string) {
    this.sent.push(data)
  }
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeWs.instances.push(this)
  }
  close() {
    this.closed = true
  }
  open() {
    this.onopen?.()
  }
  receive(event: ConsoleEvent) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
  drop() {
    this.onclose?.()
  }
}

const fakeWsFactory = (url: string, protocols: string[]) => new FakeWs(url, protocols)

/** A session past the hello step, as the AuthGate leaves it. */
function bearerSession(token: string | null = TOKEN) {
  const store = new MemoryTokenStore()
  if (token !== null) store.set(token)
  return new AuthSession({ store, mode: 'bearer' })
}

beforeEach(() => {
  FakeWs.instances = []
})

test('GET endpoints hit the pinned paths and return typed JSON', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ platform: 'test', sections: [] }))
  const facade = new HttpFacade({ baseUrl: 'http://127.0.0.1:8765', fetchImpl })
  const report = await facade.diagnose()
  expect(report.platform).toBe('test')
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://127.0.0.1:8765/api/diagnose',
    expect.objectContaining({ method: 'GET' }),
  )
})

test('POST sends a JSON body with content-type', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(jsonResponse({ status: 'ok', outcome: 'ok', message: 'fine' }))
  const facade = new HttpFacade({ baseUrl: 'http://127.0.0.1:8765', fetchImpl })
  await facade.probe({ url: 'http://leader:8099' })
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://127.0.0.1:8765/api/probe',
    expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://leader:8099' }),
    }),
  )
})

test('non-2xx maps to FacadeError with the FastAPI detail (501 = seam not landed)', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(jsonResponse({ detail: 'PROBE seam not implemented yet' }, 501))
  const facade = new HttpFacade({ baseUrl: 'http://127.0.0.1:8765', fetchImpl })
  const error = await facade.probe({ url: 'x' }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(FacadeError)
  expect((error as FacadeError).status).toBe(501)
  expect((error as FacadeError).detail).toBe('PROBE seam not implemented yet')
  expect((error as FacadeError).path).toBe('/api/probe')
})

// ── the bearer transport (contract 0.4.0) ────────────────────────────────────

test('a held token rides every request as Authorization: Bearer — hello included', async () => {
  const fetchImpl = vi
    .fn()
    .mockImplementation(async () => jsonResponse({ contract_version: '0.4.0', auth: 'bearer' }))
  const facade = new HttpFacade({
    baseUrl: 'http://127.0.0.1:8765',
    fetchImpl,
    auth: bearerSession(),
  })
  await facade.hello()
  await facade.run({ mode: 'talk', input: 'hi' })
  expect(fetchImpl).toHaveBeenNthCalledWith(
    1,
    'http://127.0.0.1:8765/api/hello',
    expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } }),
  )
  expect(fetchImpl).toHaveBeenNthCalledWith(
    2,
    'http://127.0.0.1:8765/api/run',
    expect.objectContaining({
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    }),
  )
})

test('no token → no Authorization header (never an empty Bearer)', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(jsonResponse({ contract_version: '0.4.0', auth: 'bearer' }))
  const facade = new HttpFacade({ baseUrl: 'http://x', fetchImpl, auth: bearerSession(null) })
  await facade.hello()
  expect(fetchImpl).toHaveBeenCalledWith(
    'http://x/api/hello',
    expect.objectContaining({ headers: {} }),
  )
})

test('a 401 with a held token is AUTH STATE: the token is dropped and the error is an AuthError', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Refused: token' }, 401))
  const auth = bearerSession()
  const facade = new HttpFacade({ baseUrl: 'http://x', fetchImpl, auth })
  const error = await facade.identity().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(AuthError)
  expect(error).toBeInstanceOf(FacadeError) // generic catches still work
  expect((error as AuthError).status).toBe(401)
  expect(auth.token()).toBeNull()
  expect(auth.snapshot().rejected).toBe(true)
})

test('a tokenless 401 is not a rotation: nothing to reject, still an AuthError', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Refused' }, 401))
  const auth = bearerSession(null)
  const facade = new HttpFacade({ baseUrl: 'http://x', fetchImpl, auth })
  await expect(facade.identity()).rejects.toBeInstanceOf(AuthError)
  expect(auth.snapshot().rejected).toBe(false)
})

test('/ws offers ["maxim-console-v1", "maxim.bearer.<token>"] and holds until a token exists', () => {
  const auth = bearerSession(null)
  const facade = new HttpFacade({
    baseUrl: 'http://127.0.0.1:8765',
    wsFactory: fakeWsFactory,
    auth,
  })
  const seen: string[] = []
  facade.on('*', (e) => seen.push(e.kind))
  expect(FakeWs.instances).toHaveLength(0) // bearer server, no token: nothing to offer

  auth.setToken(TOKEN) // the paste screen (or the fragment) delivered one
  expect(FakeWs.instances).toHaveLength(1)
  const ws = FakeWs.instances[0]!
  expect(ws.url).toBe('ws://127.0.0.1:8765/ws')
  expect(ws.protocols).toEqual([WS_APP_SUBPROTOCOL, `maxim.bearer.${TOKEN}`])
  ws.open()
  ws.receive(wireEvent('identity', { tier: 'clean' }))
  expect(seen).toEqual(['identity'])
})

test('sandbox (auth none) offers only the app subprotocol — the server refuses an offer without it', () => {
  const auth = new AuthSession({ store: new MemoryTokenStore(), mode: 'none' })
  const facade = new HttpFacade({ baseUrl: 'http://x', wsFactory: fakeWsFactory, auth })
  facade.on('*', () => {})
  expect(FakeWs.instances[0]!.protocols).toEqual([WS_APP_SUBPROTOCOL])
})

test('a refused handshake with a held token is confirmed over HTTP: 401 → re-login, stream suspended', async () => {
  vi.useFakeTimers()
  try {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: 'Refused' }, 401))
    const auth = bearerSession()
    const facade = new HttpFacade({
      baseUrl: 'http://x',
      fetchImpl,
      wsFactory: fakeWsFactory,
      auth,
    })
    facade.on('*', () => {})
    const ws = FakeWs.instances[0]!
    ws.drop() // closed before it ever opened: the handshake was refused
    await vi.runOnlyPendingTimersAsync() // let the identity probe settle
    expect(fetchImpl).toHaveBeenCalledWith('http://x/api/identity', expect.anything())
    expect(auth.snapshot().rejected).toBe(true)
    // no reconnect loop with a dead token
    vi.advanceTimersByTime(20_000)
    expect(FakeWs.instances).toHaveLength(1)

    // a fresh token resumes the stream with the new offer
    const fresh = 'mxc_' + 'f'.repeat(43)
    auth.setToken(fresh)
    expect(FakeWs.instances).toHaveLength(2)
    expect(FakeWs.instances[1]!.protocols).toEqual([WS_APP_SUBPROTOCOL, `maxim.bearer.${fresh}`])
  } finally {
    vi.useRealTimers()
  }
})

test('a refused handshake that is NOT an auth problem keeps the normal backoff', async () => {
  vi.useFakeTimers()
  try {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ package_version: '1', contract_version: '0.4.0' }))
    const auth = bearerSession()
    const facade = new HttpFacade({
      baseUrl: 'http://x',
      fetchImpl,
      wsFactory: fakeWsFactory,
      auth,
    })
    facade.on('*', () => {})
    FakeWs.instances[0]!.drop()
    await vi.advanceTimersByTimeAsync(500)
    expect(auth.token()).toBe(TOKEN)
    expect(FakeWs.instances).toHaveLength(2)
  } finally {
    vi.useRealTimers()
  }
})

// ── WsEventSource on its own ─────────────────────────────────────────────────

test('WsEventSource dispatches by kind and to "*", and closes on last unsubscribe', () => {
  const source = new WsEventSource({ resolveUrl: () => 'ws://test/ws', wsFactory: fakeWsFactory })
  const byKind: string[] = []
  const all: string[] = []
  const offKind = source.on('heartbeat', (e) => byKind.push(e.kind))
  const offAll = source.on('*', (e) => all.push(e.kind))
  const ws = FakeWs.instances[0]!
  ws.open()
  ws.receive(wireEvent('heartbeat', { tier: 'clean' }))
  ws.receive(wireEvent('sim_log'))
  expect(byKind).toEqual(['heartbeat'])
  expect(all).toEqual(['heartbeat', 'sim_log'])
  offKind()
  expect(ws.closed).toBe(false)
  offAll()
  expect(ws.closed).toBe(true)
  expect(FakeWs.instances).toHaveLength(1) // no reconnect after deliberate close
})

test('WsEventSource reconnects with backoff while subscribed', () => {
  vi.useFakeTimers()
  try {
    const source = new WsEventSource({ resolveUrl: () => 'ws://test/ws', wsFactory: fakeWsFactory })
    const seen: number[] = []
    source.on('heartbeat', (e) => seen.push(e.ts))
    FakeWs.instances[0]!.open()
    FakeWs.instances[0]!.drop() // connection lost
    expect(FakeWs.instances).toHaveLength(1)
    vi.advanceTimersByTime(500) // first backoff step
    expect(FakeWs.instances).toHaveLength(2)
    FakeWs.instances[1]!.open()
    FakeWs.instances[1]!.receive(wireEvent('heartbeat', { tier: 'clean', ts: 42 }))
    expect(seen).toEqual([42])
  } finally {
    vi.useRealTimers()
  }
})

test('a subscribe frame is sent on connect — and again on every reconnect', () => {
  vi.useFakeTimers()
  try {
    const source = new WsEventSource({
      resolveUrl: () => 'ws://test/ws',
      wsFactory: fakeWsFactory,
      subscribe: { tier: 'clean' },
    })
    source.on('heartbeat', () => {})
    const first = FakeWs.instances[0]!
    first.open()
    expect(first.sent).toEqual(['{"tier":"clean"}'])

    // each connection filters independently, so a reconnect must re-send
    first.drop()
    vi.advanceTimersByTime(500)
    const second = FakeWs.instances[1]!
    second.open()
    expect(second.sent).toEqual(['{"tier":"clean"}'])
  } finally {
    vi.useRealTimers()
  }
})

test('no frame is sent when no filter is configured (the Console needs everything)', () => {
  const source = new WsEventSource({ resolveUrl: () => 'ws://test/ws', wsFactory: fakeWsFactory })
  source.on('heartbeat', () => {})
  const ws = FakeWs.instances[0]!
  ws.open()
  expect(ws.sent).toEqual([])
})

test('onHandshakeRefused fires only for a close BEFORE open; suspend() stops the retry, resume() reconnects', () => {
  vi.useFakeTimers()
  try {
    const refused = vi.fn()
    const source = new WsEventSource({
      resolveUrl: () => 'ws://test/ws',
      wsFactory: fakeWsFactory,
      onHandshakeRefused: refused,
    })
    source.on('heartbeat', () => {})
    FakeWs.instances[0]!.open()
    FakeWs.instances[0]!.drop() // an OPENED socket dropping is not a refusal
    expect(refused).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    FakeWs.instances[1]!.drop() // never opened → refused
    expect(refused).toHaveBeenCalledTimes(1)

    source.suspend()
    vi.advanceTimersByTime(20_000)
    expect(FakeWs.instances).toHaveLength(2)
    source.resume()
    expect(FakeWs.instances).toHaveLength(3)
  } finally {
    vi.useRealTimers()
  }
})
