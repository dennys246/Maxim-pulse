import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useFacade } from './context'
import type { IdentityResponse } from './types'

/**
 * Backend identity, fetched once and shared.
 *
 * Seam liveness comes from here — `identity.seams[]` is the server telling us
 * what it can do, which beats firing a request and reading a 501 off the
 * floor. Components disable what the backend can't serve BEFORE the user
 * clicks, and still keep their 501 handling as a backstop for older backends
 * (which have no /api/identity at all).
 */
interface IdentityValue {
  identity: IdentityResponse | null
  /** Unknown seams read as LIVE: an older backend shouldn't disable the UI. */
  isSeamLive: (name: string) => boolean
}

const IdentityContext = createContext<IdentityValue>({ identity: null, isSeamLive: () => true })

export function IdentityProvider({ children }: { children: ReactNode }) {
  const facade = useFacade()
  const [identity, setIdentity] = useState<IdentityResponse | null>(null)

  useEffect(() => {
    let alive = true
    facade
      .identity()
      .then((response) => {
        if (alive) setIdentity(response)
      })
      .catch(() => {
        /* no /api/identity on this backend — everything stays enabled */
      })
    return () => {
      alive = false
    }
  }, [facade])

  const isSeamLive = (name: string) => {
    const seam = identity?.seams?.find((entry) => entry.name === name)
    return seam == null ? true : seam.live
  }

  return (
    <IdentityContext.Provider value={{ identity, isSeamLive }}>{children}</IdentityContext.Provider>
  )
}

export function useIdentity(): IdentityValue {
  return useContext(IdentityContext)
}
