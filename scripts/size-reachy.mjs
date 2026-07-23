#!/usr/bin/env node
/**
 * pnpm size:reachy — the Reachy on-device bundle guard (CLAUDE.md required check).
 *
 * Two assertions over apps/reachy/ui/dist:
 *   1. SIGNATURE SCAN (the real guard): no heavy-viz module may appear in ANY
 *      chunk — react-flow / visx signatures fail the build. This is what proves
 *      the code-split boundary holds (AGENTS.md § code-split).
 *   2. GZIP BUDGET (secondary): a loose total-size ceiling as an early-warning
 *      trip-wire while the shell is near-empty; tighten as real components land.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import process from 'node:process'

const DIST = 'apps/reachy/ui/dist'
const BUDGET_GZIP_BYTES = 300 * 1024 // loose starting ceiling; the signature scan is the real guard
const FORBIDDEN_SIGNATURES = ['@xyflow', 'react-flow__', 'xyflow', '@visx/', 'visx']

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`size:reachy — ${DIST} not found or incomplete. Run \`pnpm build\` first.`)
  process.exit(1)
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

let totalGzip = 0
const violations = []

for (const path of walk(DIST)) {
  if (!/\.(js|css)$/.test(path)) continue
  const content = readFileSync(path)
  totalGzip += gzipSync(content).length
  const text = content.toString('utf8')
  for (const signature of FORBIDDEN_SIGNATURES) {
    if (text.includes(signature)) {
      violations.push({ file: relative(DIST, path), signature })
      break
    }
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

if (violations.length > 0) {
  console.error('size:reachy FAILED — heavy viz leaked into the Reachy on-device bundle:')
  for (const { file, signature } of violations) {
    console.error(`  ${file}  (matched "${signature}")`)
  }
  console.error(
    'The Reachy target may import only the lean @maxim/kit entry — never @maxim/kit/viz.',
  )
  process.exit(1)
}

if (totalGzip > BUDGET_GZIP_BYTES) {
  console.error(
    `size:reachy FAILED — bundle ${kb(totalGzip)} gzip exceeds the ${kb(BUDGET_GZIP_BYTES)} budget.`,
  )
  process.exit(1)
}

console.log(
  `size:reachy OK — no heavy-viz signatures; ${kb(totalGzip)} gzip (budget ${kb(BUDGET_GZIP_BYTES)}).`,
)
