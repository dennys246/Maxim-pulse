import {
  BackendChip,
  ChatSurface,
  CORE_PANELS,
  Drawer,
  EventClientProvider,
  IdentityProvider,
  LiveStatusChip,
  PanelProvider,
  PanelRail,
  SetupWizard,
  Stack,
  TopBar,
  TopBarButton,
  TopBarLink,
  TurnStatus,
  usePanelDock,
  type PanelSpec,
} from '@maxim/kit'
import { useState } from 'react'

// LEAN bundle: this shell imports only the @maxim/kit root entry.
// @maxim/kit/viz (react-flow/visx) is forbidden here — enforced by ESLint
// no-restricted-imports and the `pnpm size:reachy` dist scan.
//
// The reachy_mini_app.md main page, now over the shared chat surface: the
// three flagship actions live in ChatSurface's input row (type = Talk,
// 🎲 = Adventure, 😴 = Rest) over ONE persistent agent, with
// "what Maxim remembers" alongside and setup behind the gear.
//
// Consumer-first panel set: memory only. The bio-activity and thinking rails
// are a developer concern on a desk robot (reachy_mini_app.md moves debug
// surfaces into a Developer drawer), and keeping them off also keeps the
// door open to subscribing at `tier: clean`, which cuts ~87% of the stream
// on a Pi.
const REACHY_PANELS: PanelSpec[] = CORE_PANELS.filter((panel) => panel.id === 'memory')

export default function App() {
  return (
    <IdentityProvider>
      <EventClientProvider>
        <PanelProvider panels={REACHY_PANELS}>
          <Shell />
        </PanelProvider>
      </EventClientProvider>
    </IdentityProvider>
  )
}

function Shell() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { toggle } = usePanelDock()

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
            <TopBarButton label="What Maxim remembers" onClick={() => toggle('memory')}>
              ✦
            </TopBarButton>
            <TopBarButton label="Settings" onClick={() => setSettingsOpen((open) => !open)}>
              ⚙
            </TopBarButton>
            <TopBarLink label="Guides — docs.pymaxim.bio" href="https://docs.pymaxim.bio/">
              ?
            </TopBarLink>
          </>
        }
      />

      <main className="flex min-h-0 flex-1 flex-row">
        <div className="min-h-0 min-w-0 flex-1">
          <ChatSurface statusSlot={<TurnStatus />} />
        </div>
        <PanelRail side="right" />
      </main>

      <Drawer open={settingsOpen} title="Settings" onClose={() => setSettingsOpen(false)}>
        <Stack className="gap-4">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Where Maxim thinks
            </h3>
            {/* Re-openable any time; the bootstrap serves setup-only when
                config has no resolvable placement (reachy_mini_app.md). */}
            <SetupWizard />
          </section>
        </Stack>
      </Drawer>
    </div>
  )
}
