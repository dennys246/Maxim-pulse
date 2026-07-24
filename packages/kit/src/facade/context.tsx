import { createContext, useContext, type ReactNode } from 'react'
import type { FacadeClient } from './types'

const FacadeContext = createContext<FacadeClient | null>(null)

/**
 * FacadeProvider — how a shell hands the Layer-1 binding to the kit. Shells
 * mount one (Console/Reachy: HttpFacade; tests: MockFacade) and every kit
 * component reads it via useFacade() — never a shell-specific prop or
 * back-channel (AGENTS.md load-bearing rule).
 */
export function FacadeProvider({
  facade,
  children,
}: {
  facade: FacadeClient
  children: ReactNode
}) {
  return <FacadeContext.Provider value={facade}>{children}</FacadeContext.Provider>
}

export function useFacade(): FacadeClient {
  const facade = useContext(FacadeContext)
  if (facade === null) {
    throw new Error('useFacade() requires a <FacadeProvider> above this component.')
  }
  return facade
}
