// The console token flow (contract 0.4.0) on the desktop Console, against `maxim serve`.
// Runs LAST: it rotates the token, which signs every other browser out.
import { CONTRACT, DESKTOP, launch, rotateToken, sleep, suite, token, visible } from './lib.mjs'

const { check, done } = suite('auth')
const first = token()
const browser = await launch()
const page = await browser.newPage()

const apiRequests = []
page.on('request', (req) => {
  const url = new URL(req.url())
  if (url.pathname.startsWith('/api/'))
    apiRequests.push({ path: url.pathname, auth: req.headers()['authorization'] ?? null })
})
const wsSockets = []
const wsFrames = []
page.on('websocket', (ws) => {
  wsSockets.push(ws.url())
  ws.on('framereceived', (frame) => {
    try {
      wsFrames.push(JSON.parse(frame.payload))
    } catch {
      /* not JSON */
    }
  })
})
const stored = () => page.evaluate(() => localStorage.getItem('maxim.console.token'))
const signIn = page.getByText('Sign in to Maxim Console')
const chat = page.getByLabel('Say something to Maxim')

// 1. cold load, no token → the paste screen; only /api/hello is touched
await page.goto(`${DESKTOP}/`)
await signIn.waitFor({ timeout: 15_000 })
check('cold load with no token renders the paste screen', true)
check(
  'no contract-skew banner (bundle and server agree)',
  !(await visible(page.getByText(/Contract mismatch/))),
)
check(
  'the paste screen names maxim serve --show-token',
  await visible(page.getByText('maxim serve --show-token')),
)
check('no rotation hint on a cold load', !(await visible(page.getByText(/may have been rotated/))))
check(
  'only /api/hello is called before a token exists',
  apiRequests.length > 0 && apiRequests.every((r) => r.path === '/api/hello'),
  JSON.stringify(apiRequests.map((r) => r.path)),
)
check('nothing is stored yet', (await stored()) === null)
check('no websocket without credentials', wsSockets.length === 0)

// 2. the printed #token= URL signs the browser in
apiRequests.length = 0
await page.goto(`${DESKTOP}/#token=${first}`)
await chat.waitFor({ timeout: 15_000 })
check('opening the #token= URL signs the browser in', true)
check('the fragment is stripped from the address bar', !page.url().includes('token'), page.url())
check('the token is stored for this device', (await stored()) === first)
check(
  'every authenticated call carries Authorization: Bearer',
  apiRequests.filter((r) => r.path !== '/api/hello').every((r) => r.auth === `Bearer ${first}`),
)
await sleep(1500)
const identity = wsFrames[0]
check('the stream opens with the identity frame first', identity?.kind === 'identity')
const served = identity?.contract_version ?? identity?.data?.contract_version
check(`the server speaks this kit's contract (${CONTRACT})`, served === CONTRACT, String(served))

// 3. a plain reload stays signed in
await page.goto(`${DESKTOP}/`)
await chat.waitFor({ timeout: 15_000 })
check('a plain reload with the stored token lands on the shell', true)

// 4. rotation mid-session → the NEXT action lands on the paste screen with the hint
rotateToken()
const rotated = token()
check('rotation produced a different token', rotated !== first)
// The next authenticated call 401s (opening Logs lists runs). The page may already be making one (a stream
// reconnect, an identity read); otherwise an action makes it.
if (!(await visible(signIn)))
  await page
    .getByLabel('Logs')
    .click({ timeout: 5_000 })
    .catch(() => {})
await signIn.waitFor({ timeout: 15_000 })
check('after --rotate-token the next action lands on the paste screen', true)
check(
  'the paste screen carries the rotation hint',
  await visible(page.getByText(/may have been rotated/)),
)
check('the dead token was dropped from storage', (await stored()) === null)
const socketsBefore = wsSockets.length
await sleep(4000)
check('no reconnect loop with the dead token', wsSockets.length === socketsBefore)

// 5. a wrong paste is refused in place; the right one signs back in
await page.getByLabel('Console token').fill('mxc_' + 'x'.repeat(43))
await page.getByRole('button', { name: 'Sign in' }).click()
await sleep(800)
check('a wrong but well-formed token stays on the paste screen', await visible(signIn))
await page.getByLabel('Console token').fill(rotated)
await page.getByRole('button', { name: 'Sign in' }).click()
await chat.waitFor({ timeout: 15_000 })
check('pasting the rotated token signs in again', (await stored()) === rotated)

await browser.close()
done()
