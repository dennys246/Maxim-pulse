#!/usr/bin/env node
/**
 * Write `maxim-ui.json` into each built bundle — the contract stamp.
 *
 * Runs as part of `pnpm build`, NOT only when packaging: any bundle that can
 * be served must carry its stamp. `maxim serve` compares
 * `maxim-ui.json::contract_version` against its own CONSOLE_CONTRACT_VERSION,
 * so an unstamped bundle is an unverifiable one — including the common dev
 * case of serving `apps/console/dist` directly via --ui-dist.
 *
 * `contract_version` is openapi.json's info.version: the maxim serve contract
 * this bundle's typed client was generated against. It is the one drift
 * `gen:facade:check` cannot see, because it crosses the release boundary.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

export const TARGETS = [
  { name: 'console', dist: 'apps/console/dist', pkg: 'apps/console/package.json' },
  { name: 'reachy', dist: 'apps/reachy/ui/dist', pkg: 'apps/reachy/ui/package.json' },
]
const CONTRACT = 'packages/kit/openapi.json'

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

/** Stamp every built target; returns the stamps written. */
export function stampDists() {
  const contractVersion = JSON.parse(readFileSync(CONTRACT, 'utf8')).info?.version ?? 'unknown'
  const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown'
  const dirty = git(['status', '--porcelain']) !== ''

  const written = []
  for (const target of TARGETS) {
    if (!existsSync(join(target.dist, 'index.html'))) continue // not built; skip quietly
    const stamp = {
      target: target.name,
      app_version: JSON.parse(readFileSync(target.pkg, 'utf8')).version,
      contract_version: contractVersion,
      commit: dirty ? `${commit}-dirty` : commit,
    }
    writeFileSync(join(target.dist, 'maxim-ui.json'), `${JSON.stringify(stamp, null, 2)}\n`)
    written.push({ target, stamp })
  }
  return written
}

// CLI: `node scripts/stamp-dist.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const written = stampDists()
  if (written.length === 0) {
    console.log('stamp — nothing built yet; run `pnpm build` first.')
  } else {
    for (const { target, stamp } of written) {
      console.log(`stamp — ${target.dist}/maxim-ui.json (contract ${stamp.contract_version})`)
    }
  }
}
