import { useEffect, useState } from 'react'
import { CONTRACT_VERSION } from '../facade/contractVersion'
import { useFacade } from '../facade/context'
import type { IdentityResponse } from '../facade/types'
import { StatusChip } from './StatusChip'

/**
 * BackendChip — which backend am I actually talking to?
 *
 * pymaxim is typically installed editable, so `maxim serve` follows whatever
 * branch is checked out: capabilities change under you with no visible signal.
 * This surfaces branch@sha alongside the version, and compares the server's
 * contract against the one THIS UI's client was generated from
 * (CONTRACT_VERSION) — a mismatch means the types in this bundle describe a
 * different API than the server speaks, which is the one drift
 * `gen:facade:check` can't see because it crosses the release boundary.
 */
export function BackendChip() {
  const facade = useFacade()
  const [identity, setIdentity] = useState<IdentityResponse | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let alive = true
    facade
      .identity()
      .then((response) => {
        if (alive) setIdentity(response)
      })
      .catch(() => {
        // older backends have no /api/identity — degrade, don't shout
        if (alive) setUnavailable(true)
      })
    return () => {
      alive = false
    }
  }, [facade])

  if (unavailable) return <StatusChip label="backend: unknown" tone="idle" />
  if (identity === null) return <StatusChip label="backend…" tone="idle" />

  const drift = identity.contract_version !== CONTRACT_VERSION
  const where =
    identity.git_branch != null
      ? `${identity.git_branch}${identity.git_sha != null ? `@${identity.git_sha.slice(0, 7)}` : ''}`
      : `v${identity.package_version}`
  const deadSeams = (identity.seams ?? []).filter((seam) => !seam.live).map((seam) => seam.name)

  return (
    <span
      title={
        drift
          ? `Contract mismatch — this UI was built for ${CONTRACT_VERSION}, the server speaks ${identity.contract_version}. Rebuild the bundle (pnpm build).`
          : `pymaxim ${identity.package_version} · contract ${identity.contract_version} · ui from ${identity.ui_source}${
              deadSeams.length > 0 ? ` · not live: ${deadSeams.join(', ')}` : ''
            }`
      }
    >
      <StatusChip
        label={drift ? `⚠ contract ${identity.contract_version} ≠ ${CONTRACT_VERSION}` : where}
        tone={drift ? 'warn' : 'ok'}
      />
    </span>
  )
}
