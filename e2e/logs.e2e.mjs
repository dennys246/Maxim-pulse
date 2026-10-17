// The Logs explorer and live health (contract 0.6.0) over a history written by pymaxim's
// own writers (e2e/seed_history.py), against `maxim serve`.
import { DESKTOP, launch, sleep, suite, token, visible } from './lib.mjs'

const { check, done } = suite('logs')
const key = token()
const auth = { Authorization: `Bearer ${key}` }

// the boundary, straight over HTTP
const list = await (await fetch(`${DESKTOP}/api/runs?limit=50`, { headers: auth })).json()
check(
  'the seeded runs are listed, newest first',
  list.runs?.[0]?.session_id === 'e2e_20261016_090000',
  JSON.stringify(list.runs?.map((r) => r.session_id)),
)
for (const hostile of ['..%2f..%2fetc', '..', 'evil%00']) {
  const r = await fetch(`${DESKTOP}/api/runs/${hostile}`, { headers: auth })
  check(`a hostile run id (${hostile}) is a 404`, r.status === 404, String(r.status))
}
check('no token → 401', (await fetch(`${DESKTOP}/api/runs`)).status === 401)

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const sent = []
const kinds = []
page.on('websocket', (ws) => {
  ws.on('framesent', (f) => sent.push(f.payload))
  ws.on('framereceived', (f) => {
    try {
      kinds.push(JSON.parse(f.payload).kind)
    } catch {
      /* not JSON */
    }
  })
})
await page.goto(`${DESKTOP}/#token=${key}`)
await page.getByLabel('Say something to Maxim').waitFor({ timeout: 15_000 })

// live health
const strip = page.getByRole('status', { name: 'Host health' })
await strip.waitFor({ timeout: 30_000 })
check(
  'the health strip shows a real host sample',
  /CPU \d+%/.test(await strip.textContent()),
  await strip.textContent(),
)
check(
  'the health opt-in is sent after the identity frame',
  sent.some((f) => f.includes('"kinds":["health","health_stall"]')),
  JSON.stringify(sent),
)
await sleep(12_000)
check(
  'live health samples arrive on /ws',
  kinds.includes('health'),
  `${kinds.filter((k) => k === 'health').length} samples`,
)

// runs → a run → its actions, with credit read from pymaxim's real actions.jsonl
await page.getByLabel('Logs').click()
const runs = page.getByRole('table', { name: 'Past runs' })
await runs.waitFor({ timeout: 15_000 })
check('Logs → Runs lists the finished runs', (await runs.getByRole('row').count()) === 3) // header + 2
const aborted = page.getByRole('button', { name: /Show aborted runs \(1\)/ })
check('the aborted run is behind a toggle', await visible(aborted))
await runs.getByRole('button').first().click()
const actions = page.getByRole('region', { name: 'Actions' })
await actions.getByRole('listitem').first().waitFor({ timeout: 15_000 })
const items = await actions.getByRole('listitem').allTextContents()
check(
  'the run opens with its actions in order',
  items.length === 3 && items[0].startsWith('1sense_tools'),
  JSON.stringify(items),
)
check(
  'per-action credit renders from the real file',
  /booked by bridge/.test(items[1] ?? '') && /rpe −0\.42/.test(items[1] ?? ''),
  items[1],
)
check('the report shows its goal', await visible(page.getByText('e2e: tidy the desk')))
await page.getByRole('button', { name: '← All runs' }).click()
await aborted.click()
await runs.locator('tr', { hasText: 'aborted' }).getByRole('button').click()
check(
  'an aborted run explains its missing report',
  await page
    .getByText(/ended before writing one/)
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    ),
)

// the honest tabs
await page.getByRole('button', { name: '← All runs' }).click()
await page.getByRole('tab', { name: 'Degraded' }).click()
check(
  'the Degraded tab renders',
  await page
    .getByText(/degraded silently/)
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    ),
)
await page.getByRole('tab', { name: 'Health' }).click()
check(
  'the Health tab is honest that no agent loop runs here',
  await page
    .getByText(/no agent loop is running in this process/)
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    ),
)

await browser.close()
done()
