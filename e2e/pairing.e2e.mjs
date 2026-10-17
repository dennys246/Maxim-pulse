// Spoken-code pairing (contract 0.5.0, A9.1) on the Reachy bundle, against a device-shaped
// build_app whose stub announcer writes the code to a file (the harness's ears).
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { DESKTOP, DEVICE, SPOKEN_FILE, launch, sleep, suite, visible } from './lib.mjs'

const { check, done } = suite('pairing')
const heard = async () => {
  for (let i = 0; i < 50; i++) {
    if (existsSync(SPOKEN_FILE)) return readFileSync(SPOKEN_FILE, 'utf8').trim()
    await sleep(100)
  }
  return null
}

const browser = await launch()

// a plain `maxim serve` never offers pairing
{
  const page = await browser.newPage()
  await page.goto(`${DESKTOP}/`)
  await page.getByText('Sign in to Maxim Console').waitFor({ timeout: 15_000 })
  check(
    'a desktop backend shows no by-ear path',
    !(await visible(page.getByRole('button', { name: 'Have the robot say a code' }))),
  )
  await page.close()
}

const page = await browser.newPage()
const stored = () => page.evaluate(() => localStorage.getItem('maxim.console.token'))
await page.goto(`${DEVICE}/`)
await page.getByText('Sign in to Maxim Console').waitFor({ timeout: 15_000 })
const ask = page.getByRole('button', { name: 'Have the robot say a code' })
check('a device backend offers the by-ear path', await visible(ask))
check(
  'the paste path is still offered',
  await visible(page.getByRole('button', { name: 'Sign in with a token' })),
)

if (existsSync(SPOKEN_FILE)) unlinkSync(SPOKEN_FILE)
await ask.click()
const code = await heard()
check('the robot "spoke" a 6-digit code', code !== null && /^\d{6}$/.test(code))
check('the code never reaches the page', code !== null && !(await page.content()).includes(code))

// a wrong code is refused with the server's own reason; the box stays claimable
await page.getByLabel('Spoken code').fill(code === '000000' ? '111111' : '000000')
await page.getByRole('button', { name: 'Sign in with this code' }).click()
await page.getByText('Wrong code.').waitFor({ timeout: 10_000 })
check(
  'a wrong code shows the server’s reason and stays claimable',
  await visible(page.getByLabel('Spoken code')),
)
check('nothing is stored on a failed claim', (await stored()) === null)

// the right code typed straight after (the server paces claims; the client retries a 429 once)
await page.getByLabel('Spoken code').fill(code)
await page.getByRole('button', { name: 'Sign in with this code' }).click()
await page.getByLabel('Say something to Maxim').waitFor({ timeout: 15_000 })
const claimed = await stored()
check(
  'the correct code signs in right after a wrong one',
  /^mxc_[A-Za-z0-9_-]{43}$/.test(claimed ?? ''),
)
check('the token is not in the page', !(await page.content()).includes(claimed))

// a second ask within 10 s is paced — no code babble
const second = await browser.newPage()
await second.goto(`${DEVICE}/`)
await second.getByRole('button', { name: 'Have the robot say a code' }).click()
await second.getByText(/just announced|speaking a 6-digit/).waitFor({ timeout: 10_000 })
check(
  'a second ask within 10 s is paced by the server',
  await visible(second.getByText(/just announced/)),
)

await browser.close()
done()
