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
 * Each archive's root IS the dist root (extract straight into ui_dist/), and
 * carries the `maxim-ui.json` contract stamp written by `pnpm build`
 * (re-stamped here so a hand-built dist is never packed unstamped).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { stampDists, TARGETS } from './stamp-dist.mjs'

const OUT_DIR = 'artifacts'

for (const target of TARGETS) {
  if (!existsSync(join(target.dist, 'index.html'))) {
    console.error(`dist:pack — ${target.dist} is missing or incomplete. Run \`pnpm build\` first.`)
    process.exit(1)
  }
}

const stamps = new Map(stampDists().map(({ target, stamp }) => [target.name, stamp]))
mkdirSync(OUT_DIR, { recursive: true })

for (const target of TARGETS) {
  const stamp = stamps.get(target.name)
  // Asset names stay stable (the release tag disambiguates); `.vite/` build
  // metadata is not part of what gets served.
  const archive = join(OUT_DIR, `${target.name}-dist.tar.gz`)
  execFileSync('tar', ['--exclude', './.vite', '-czf', archive, '-C', target.dist, '.'])
  console.log(
    `dist:pack — ${archive}  (contract ${stamp.contract_version}, commit ${stamp.commit})`,
  )
}

if ([...stamps.values()].some((stamp) => stamp.commit.endsWith('-dirty'))) {
  console.log('dist:pack — NOTE: working tree is dirty; bundles are stamped "-dirty".')
}
