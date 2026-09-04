import { vi } from 'vitest'
import {
  AuthSession,
  LocalStorageTokenStore,
  MemoryTokenStore,
  TOKEN_STORAGE_KEY,
  WS_APP_SUBPROTOCOL,
  extractToken,
  isTokenShaped,
} from './auth'

const TOKEN = 'mxc_' + 'a'.repeat(43)

function fakeWindow(hash: string) {
  const history = { replaceState: vi.fn() }
  return {
    win: { location: { hash, pathname: '/', search: '' }, history } as unknown as Pick<
      Window,
      'location' | 'history'
    >,
    history,
  }
}

test('token shape is mxc_ + 43 url-safe chars', () => {
  expect(isTokenShaped(TOKEN)).toBe(true)
  expect(isTokenShaped('mxc_short')).toBe(false)
  expect(isTokenShaped('abc_' + 'a'.repeat(43))).toBe(false)
  expect(isTokenShaped('mxc_' + 'a'.repeat(42) + '!')).toBe(false)
})

test('extractToken accepts the bare token or the whole printed URL', () => {
  expect(extractToken(`  ${TOKEN}\n`)).toBe(TOKEN)
  expect(extractToken(`http://127.0.0.1:8765/#token=${TOKEN}`)).toBe(TOKEN)
  expect(extractToken('maxim serve --show-token')).toBeNull()
  expect(extractToken(`http://127.0.0.1:8765/?token=${TOKEN}`)).toBeNull() // query is refused by design
})

test('fragment bootstrap stores the token and strips it from the URL', () => {
  const store = new MemoryTokenStore()
  const session = new AuthSession({ store })
  const { win, history } = fakeWindow(`#token=${TOKEN}`)
  expect(session.bootstrapFromLocation(win)).toBe(true)
  expect(store.get()).toBe(TOKEN)
  expect(session.token()).toBe(TOKEN)
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/')
})

test('fragment bootstrap keeps other fragment params and ignores non-token hashes', () => {
  const session = new AuthSession({ store: new MemoryTokenStore() })
  const { win, history } = fakeWindow(`#token=${TOKEN}&panel=memory`)
  expect(session.bootstrapFromLocation(win)).toBe(true)
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/#panel=memory')

  const plain = fakeWindow('#panel=memory')
  expect(new AuthSession({ store: new MemoryTokenStore() }).bootstrapFromLocation(plain.win)).toBe(
    false,
  )
  expect(plain.history.replaceState).not.toHaveBeenCalled()
})

test('a malformed fragment token is stripped but never stored', () => {
  const store = new MemoryTokenStore()
  const session = new AuthSession({ store })
  const { win, history } = fakeWindow('#token=not-a-token')
  expect(session.bootstrapFromLocation(win)).toBe(false)
  expect(store.get()).toBeNull()
  expect(history.replaceState).toHaveBeenCalled()
})

test('a fragment token replaces a stored one (re-opening the printed URL after rotation)', () => {
  const store = new MemoryTokenStore()
  store.set('mxc_' + 'o'.repeat(43))
  const session = new AuthSession({ store })
  const fresh = 'mxc_' + 'n'.repeat(43)
  session.bootstrapFromLocation(fakeWindow(`#token=${fresh}`).win)
  expect(session.token()).toBe(fresh)
})

test('reject() drops the token, flags the rotation, and setToken() clears the flag', () => {
  const store = new MemoryTokenStore()
  store.set(TOKEN)
  const session = new AuthSession({ store, mode: 'bearer' })
  const seen: boolean[] = []
  session.subscribe((snapshot) => seen.push(snapshot.rejected))

  session.reject()
  expect(session.token()).toBeNull()
  expect(store.get()).toBeNull()
  expect(session.snapshot().rejected).toBe(true)
  expect(session.canConnect()).toBe(false)

  session.setToken(TOKEN)
  expect(session.snapshot().rejected).toBe(false)
  expect(seen).toEqual([true, false])

  // rejecting with nothing held is a no-op (a tokenless 401 is not a rotation)
  session.clearToken()
  session.reject()
  expect(session.snapshot().rejected).toBe(false)
})

test('the /ws offer always carries the app subprotocol; held while credentials are unknown', () => {
  const session = new AuthSession({ store: new MemoryTokenStore() })
  expect(session.wsProtocols()).toBeNull() // mode unknown, no token: hold
  session.setMode('bearer')
  expect(session.wsProtocols()).toBeNull()
  session.setToken(TOKEN)
  expect(session.wsProtocols()).toEqual([WS_APP_SUBPROTOCOL, `maxim.bearer.${TOKEN}`])

  const sandbox = new AuthSession({ store: new MemoryTokenStore(), mode: 'none' })
  expect(sandbox.wsProtocols()).toEqual([WS_APP_SUBPROTOCOL])
})

test('LocalStorageTokenStore persists under the fixed key and survives a throwing storage', () => {
  // Node's own experimental `localStorage` global shadows jsdom's here, so
  // install a Storage-shaped stub explicitly (browsers have the real thing).
  const backing = new Map<string, string>()
  let blocked = false
  const storage = {
    getItem: (key: string) => {
      if (blocked) throw new Error('blocked')
      return backing.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error('blocked')
      backing.set(key, value)
    },
    removeItem: (key: string) => {
      if (blocked) throw new Error('blocked')
      backing.delete(key)
    },
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  try {
    const store = new LocalStorageTokenStore()
    store.set(TOKEN)
    expect(backing.get(TOKEN_STORAGE_KEY)).toBe(TOKEN)
    expect(new LocalStorageTokenStore().get()).toBe(TOKEN) // a fresh page load finds it
    store.clear()
    expect(backing.has(TOKEN_STORAGE_KEY)).toBe(false)

    blocked = true
    const fallback = new LocalStorageTokenStore()
    fallback.set(TOKEN)
    expect(fallback.get()).toBe(TOKEN) // memory fallback for this page's lifetime
  } finally {
    Reflect.deleteProperty(window, 'localStorage')
  }
})
