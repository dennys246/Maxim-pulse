// One console, two devices: the Console and Reachy profiles over the shared kit shell.
import { DESKTOP, DEVICE, launch, sleep, suite, token, visible } from './lib.mjs'

const { check, done } = suite('shell')
const browser = await launch()
const key = token() // the device server shares this HOME, so one token signs in to both

// ── the Console profile ──
{
  const page = await browser.newPage()
  const frames = []
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => frames.push(['sent', f.payload]))
    ws.on('framereceived', (f) => {
      try {
        frames.push(['recv', JSON.parse(f.payload).kind])
      } catch {
        /* not JSON */
      }
    })
  })
  await page.goto(`${DESKTOP}/#token=${key}`)
  await page.getByLabel('Say something to Maxim').waitFor({ timeout: 15_000 })
  check('console: signs in to the shared shell', true)
  check(
    'console: both rails',
    (await visible(page.getByLabel('left panel rail'))) &&
      (await visible(page.getByLabel('right panel rail'))),
  )
  check(
    'console: the GitHub link comes from the profile',
    (await page.getByLabel('GitHub').getAttribute('href')) === 'https://github.com/dennys246/Maxim',
  )
  await sleep(1500)
  check(
    'console: the stream opens with the identity frame',
    frames.find((f) => f[0] === 'recv')?.[1] === 'identity',
  )
  check(
    'console: no tier filter (the Console shows the bio tier)',
    !frames.some((f) => f[0] === 'sent' && f[1].includes('"tier"')),
    JSON.stringify(frames.filter((f) => f[0] === 'sent')),
  )
  await page.getByLabel('Settings').click()
  check(
    'console: settings has setup and the connection test',
    (await visible(page.getByText('Where should Maxim think?'))) &&
      (await visible(page.getByRole('button', { name: 'Test connection' }))),
  )
  await page.getByLabel('Close Settings').click()
  check(
    'console: no Models button until pymaxim reports model status',
    !(await visible(page.getByLabel('Models'))),
  )
  await page.close()
}

// ── the Reachy profile ──
{
  const page = await browser.newPage()
  const sent = []
  page.on('websocket', (ws) => ws.on('framesent', (f) => sent.push(f.payload)))
  await page.goto(`${DEVICE}/#token=${key}`)
  await page.getByLabel('Say something to Maxim').waitFor({ timeout: 15_000 })
  check('reachy: signs in to the shared shell', true)
  check(
    'reachy: right rail only',
    (await visible(page.getByLabel('right panel rail'))) &&
      !(await visible(page.getByLabel('left panel rail'))),
  )
  check(
    'reachy: no Models button, no GitHub link',
    !(await visible(page.getByLabel('Models'))) && !(await visible(page.getByLabel('GitHub'))),
  )
  await sleep(1500)
  check(
    'reachy: the stream asks for the clean tier',
    sent.some((f) => f.includes('"tier":"clean"')),
    JSON.stringify(sent),
  )
  await page.getByLabel('Settings').click()
  check(
    'reachy: settings is setup only',
    (await visible(page.getByText('Where Maxim thinks'))) &&
      !(await visible(page.getByRole('button', { name: 'Test connection' }))),
  )
  await page.close()
}

await browser.close()
done()
