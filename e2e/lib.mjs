// Shared helpers for the browser end-to-end suite (run it through scripts/e2e.sh).
//
// The suite drives the BUILT bundles in real Chrome against a real, published
// pymaxim — `maxim serve` for the desktop Console and a device-shaped
// `build_app` (e2e/device_server.py) for Reachy — in a throwaway venv + HOME.
// Nothing is mocked but the robot's ears (the stub announcer writes the code
// to a file) and the run history (seeded with pymaxim's own writers).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const env = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — run the suite through scripts/e2e.sh`)
  return value
}

export const DESKTOP = env('E2E_DESKTOP')
export const DEVICE = env('E2E_DEVICE')
export const SPOKEN_FILE = env('E2E_SPOKEN_FILE')
const MAXIM = env('E2E_MAXIM')

/** The contract this checkout's kit was generated against. */
export const CONTRACT = readFileSync(
  new URL('../packages/kit/src/facade/contractVersion.ts', import.meta.url),
  'utf8',
).match(/CONTRACT_VERSION = '([^']+)'/)[1]

const TOKEN_RE = /mxc_[A-Za-z0-9_-]{43}/
/** The console token, read fresh: the auth suite rotates it. */
export const token = () =>
  execFileSync(MAXIM, ['serve', '--show-token'], { encoding: 'utf8' }).match(TOKEN_RE)[0]
export const rotateToken = () =>
  execFileSync(MAXIM, ['serve', '--rotate-token'], { stdio: 'ignore' })
const redact = (s) => String(s).replace(new RegExp(TOKEN_RE, 'g'), 'mxc_<redacted>')

/** One suite's PASS/FAIL ledger; `done()` prints the tally and sets the exit code. */
export function suite(name) {
  const results = []
  return {
    check(label, ok, detail = '') {
      results.push(Boolean(ok))
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${redact(detail)}` : ''}`)
    },
    done() {
      const passed = results.filter(Boolean).length
      console.log(`${name}: ${passed}/${results.length} passed\n`)
      if (passed !== results.length) process.exitCode = 1
    },
  }
}

export const launch = () =>
  chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || 'chrome', headless: true })
export const visible = (locator) => locator.isVisible().catch(() => false)
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
