import { vi } from 'vitest'
import { WsEventSource, type WsLike } from './events'
import { wireEvent } from './mock'
import { FacadeError, HttpFacade } from './http'
import type { ConsoleEvent } from './types'

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
  constructor(readonly url: string) {
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

test('WsEventSource dispatches by kind and to "*", and closes on last unsubscribe', () => {
  const source = new WsEventSource(
    () => 'ws://test/ws',
    (url) => new FakeWs(url),
  )
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
    const source = new WsEventSource(
      () => 'ws://test/ws',
      (url) => new FakeWs(url),
    )
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
    const source = new WsEventSource(
      () => 'ws://test/ws',
      (url) => new FakeWs(url),
      { tier: 'clean' },
    )
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
  const source = new WsEventSource(
    () => 'ws://test/ws',
    (url) => new FakeWs(url),
  )
  source.on('heartbeat', () => {})
  const ws = FakeWs.instances[0]!
  ws.open()
  expect(ws.sent).toEqual([])
})
