import { createContext, useContext, useState, type ReactNode } from 'react'
import { AuthGate } from '../components/AuthGate'
import { BackendChip } from '../components/BackendChip'
import { ChatSurface } from '../components/ChatSurface'
import { LiveStatusChip } from '../components/LiveStatusChip'
import { HealthStrip } from '../components/logs/HealthViews'
import { PanelProvider, PanelRail, usePanelDock } from '../components/PanelDock'
import { TurnStatus } from '../components/TurnStatus'
import { Drawer } from '../design/Drawer'
import { TopBar, TopBarButton, TopBarLink } from '../design/TopBar'
import { EventClientProvider } from '../facade/eventClient'
import { IdentityProvider, useIdentity } from '../facade/identity'
import type { DeviceProfile, SeamRequirement, TopBarAction } from './profile'

/**
 * ConsoleApp — the whole console for one device profile.
 *
 * The provider stack is fixed and in this order on purpose: the AuthGate opens
 * only once `/api/hello` answered and (on a bearer server) the stored token
 * verified, so nothing below it touches the backend before then, and a rotated
 * token drops every device back to the sign-in screen from ONE place.
 *
 * Mount it inside a FacadeProvider (and an AuthSessionProvider for a real
 * backend) — `bootConsole` does both.
 */
export function ConsoleApp({ profile }: { profile: DeviceProfile }) {
  return (
    <AuthGate>
      <IdentityProvider>
        <EventClientProvider>
          <PanelProvider panels={profile.panels}>
            <SelectedModelProvider>
              <ConsoleShell profile={profile} />
            </SelectedModelProvider>
          </PanelProvider>
        </EventClientProvider>
      </IdentityProvider>
    </AuthGate>
  )
}

/**
 * The model the operator picked, shared by the top-bar button that shows it
 * and the drawer that sets it. Shell state, so any device's profile can offer
 * a model picker without inventing its own plumbing.
 */
const SelectedModelContext = createContext<{
  model: string | undefined
  setModel: (model: string | undefined) => void
}>({ model: undefined, setModel: () => {} })

function SelectedModelProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<string | undefined>()
  return (
    <SelectedModelContext.Provider value={{ model, setModel }}>
      {children}
    </SelectedModelContext.Provider>
  )
}

export function useSelectedModel() {
  return useContext(SelectedModelContext)
}

/**
 * Why a surface cannot render, or null when every required seam is live.
 * A seam the server DECLARES but reports not live carries the server's own
 * reason ("closed in sandbox mode", "this server is not sampling health"); a
 * seam it does not declare at all means an older backend.
 */
function useUnmetReason(requirement: SeamRequirement): string | null {
  const { identity, hasSeam } = useIdentity()
  for (const name of requirement.requires ?? []) {
    if (hasSeam(name)) continue
    const declared = identity?.seams?.find((seam) => seam.name === name)
    if (declared?.detail != null) return declared.detail
    return (
      requirement.missing ??
      'This needs a newer Maxim backend than the one this console is talking to.'
    )
  }
  return null
}

function ConsoleShell({ profile }: { profile: DeviceProfile }) {
  const [open, setOpen] = useState<string | null>(null)
  const { toggle } = usePanelDock()
  const close = () => setOpen(null)

  const activate = (action: TopBarAction) => {
    if (action.togglesPanel != null) toggle(action.togglesPanel)
    if (action.opens != null) {
      const id = action.opens
      setOpen((prev) => (prev === id ? null : id))
    }
  }

  return (
    <div className="flex h-screen flex-col bg-bg font-sans text-fg">
      <TopBar
        left={
          <>
            <LiveStatusChip />
            <BackendChip />
          </>
        }
        right={
          <>
            {profile.actions.map((action) => (
              <ActionButton key={action.id} action={action} onActivate={() => activate(action)} />
            ))}
            {profile.links.map((link) => (
              <TopBarLink key={link.href} label={link.label} href={link.href}>
                {link.content}
              </TopBarLink>
            ))}
          </>
        }
      />

      {profile.health === true && <HealthStrip />}

      {/* the terminal's two-column body, generalized: rails flank the chat core */}
      <main className="flex min-h-0 flex-1 flex-row">
        {profile.rails.left && <PanelRail side="left" />}
        <div className="min-h-0 min-w-0 flex-1">
          <ChatSurface statusSlot={<TurnStatus />} />
        </div>
        {profile.rails.right && <PanelRail side="right" />}
      </main>

      {profile.drawers.map((drawer) => (
        <Drawer
          key={drawer.id}
          open={open === drawer.id}
          title={drawer.title}
          onClose={close}
          wide={drawer.wide === true}
        >
          {/* Drawer renders nothing while closed, so a drawer's content mounts on open. */}
          <Gated requirement={drawer}>{drawer.render(close)}</Gated>
        </Drawer>
      ))}
    </div>
  )
}

function ActionButton({ action, onActivate }: { action: TopBarAction; onActivate: () => void }) {
  const Content = typeof action.content === 'function' ? action.content : null
  return (
    <TopBarButton label={action.label} onClick={onActivate}>
      {Content != null ? <Content /> : (action.content as ReactNode)}
    </TopBarButton>
  )
}

/**
 * Renders the surface when its seams are live; otherwise says what the backend
 * needs. Never a blank panel: an operator on an older backend learns why.
 */
export function Gated({
  requirement,
  children,
}: {
  requirement: SeamRequirement
  children: ReactNode
}) {
  const reason = useUnmetReason(requirement)
  if (reason === null) return <>{children}</>
  return (
    <p role="status" className="text-sm text-fg-muted">
      {reason}
    </p>
  )
}
