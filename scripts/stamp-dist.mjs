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
 * The stamp answers three questions a consumer needs and could not previously
 * ask:
 *
 * - WHICH bundle is this?  `describe` is tag-anchored (`v0.2.0-3-gb1b3aaa`),
 *   so two builds are distinguishable even when package.json has not moved.
 * - IS IT STALE?  `commit_date` is the HEAD committer date — orderable, so a
 *   vendored bundle can be compared against the source it should match.
 *   Deliberately NOT a build timestamp: that would make every rebuild differ
 *   and destroy byte-identical reproducibility. Source time answers staleness;
 *   wall-clock build time does not.
 * - DOES IT MATCH THE BACKEND?  `contract_version` is openapi.json's
 *   info.version — the maxim serve contract this bundle's typed client was
 *   generated against. It is the one drift `gen:facade:check` cannot see,
 *   because it crosses the release boundary.
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
    // TZ=UTC so commit_date is identical whoever builds it
    return execFileSync('git', args, {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'UTC' },
    }).trim()
  } catch {
    return ''
  }
}

/** Fields a bundle must carry to be identifiable, checkable and matchable. */
export const REQUIRED_STAMP_FIELDS = [
  'target',
  'app_version',
  'contract_version',
  'commit',
  'commit_date',
  'describe',
]

/** Stamp every built target; returns the stamps written. */
export function stampDists() {
  const contractVersion = JSON.parse(readFileSync(CONTRACT, 'utf8')).info?.version ?? 'unknown'
  const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown'
  const commitDate = git(['log', '-1', '--format=%cd', '--date=iso-strict-local']) || null
  // --always so an untagged repo still yields the sha rather than nothing
  const describe = git(['describe', '--tags', '--always', '--dirty']) || commit
  const dirty = git(['status', '--porcelain']) !== ''

  const written = []
  for (const target of TARGETS) {
    if (!existsSync(join(target.dist, 'index.html'))) continue // not built; skip quietly
    const stamp = {
      target: target.name,
      app_version: JSON.parse(readFileSync(target.pkg, 'utf8')).version,
      contract_version: contractVersion,
      // `commit` stays a clean sha; dirtiness is its own field rather than a
      // suffix, so consumers can parse either without string surgery.
      commit,
      commit_date: commitDate,
      describe,
      dirty,
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
