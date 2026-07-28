#!/usr/bin/env node
/**
 * pnpm dist:pack — package the built UI bundles for PYTHON consumers.
 *
 * The console/Reachy bundles are built here but served from Python
 * (`maxim serve --ui-dist`, the ReachyMiniApp bootstrap). `dist/` is
 * gitignored build output, so a shipped `pip install pymaxim && maxim serve`
 * needs the bundle vendored INTO the wheel as package data. This produces the
 * artifact that handoff consumes:
 *
 *   artifacts/console-dist.tar.gz  → src/maxim/console/ui_dist/
 *   artifacts/reachy-dist.tar.gz   → maxim_reachy_app/ui_dist/
 *
 * Each archive's root IS the dist root (extract straight into ui_dist/).
 *
 * CONTRACT STAMP — every bundle carries `maxim-ui.json`:
 *   { target, app_version, contract_version, commit }
 * `contract_version` is openapi.json's info.version, i.e. the maxim serve
 * contract this bundle was generated against. A server whose own contract
 * version differs is serving a bundle built for a different API — the one
 * drift `gen:facade:check` cannot see, because it crosses the release
 * boundary. Consumers should read this file and warn on mismatch.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const TARGETS = [
  { name: 'console', dist: 'apps/console/dist', pkg: 'apps/console/package.json' },
  { name: 'reachy', dist: 'apps/reachy/ui/dist', pkg: 'apps/reachy/ui/package.json' },
]
const OUT_DIR = 'artifacts'
const CONTRACT = 'packages/kit/openapi.json'

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const contractVersion = JSON.parse(readFileSync(CONTRACT, 'utf8')).info?.version ?? 'unknown'
const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown'
const dirty = git(['status', '--porcelain']) !== ''

mkdirSync(OUT_DIR, { recursive: true })

for (const target of TARGETS) {
  if (!existsSync(join(target.dist, 'index.html'))) {
    console.error(`dist:pack — ${target.dist} is missing or incomplete. Run \`pnpm build\` first.`)
    process.exit(1)
  }

  const appVersion = JSON.parse(readFileSync(target.pkg, 'utf8')).version
  const stamp = {
    target: target.name,
    app_version: appVersion,
    contract_version: contractVersion,
    commit: dirty ? `${commit}-dirty` : commit,
  }
  writeFileSync(join(target.dist, 'maxim-ui.json'), `${JSON.stringify(stamp, null, 2)}\n`)

  // Asset names stay stable (the release tag disambiguates); `.vite/` build
  // metadata is not part of what gets served.
  const archive = join(OUT_DIR, `${target.name}-dist.tar.gz`)
  execFileSync('tar', ['--exclude', './.vite', '-czf', archive, '-C', target.dist, '.'])
  console.log(`dist:pack — ${archive}  (contract ${contractVersion}, commit ${stamp.commit})`)
}

if (dirty) {
  console.log('dist:pack — NOTE: working tree is dirty; bundles are stamped "-dirty".')
}
