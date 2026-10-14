import {
  ConnectionTest,
  CORE_PANELS,
  LogsSurface,
  ModelPicker,
  SetupWizard,
  Stack,
  useSelectedModel,
  type DeviceProfile,
} from '@maxim/kit'
import { lazy, Suspense, useState } from 'react'

/**
 * The Console's device profile — everything that makes this console the
 * localhost dashboard rather than the robot page. The shell itself (auth,
 * providers, top bar, chat core, rails, drawers) lives in the kit and is shared
 * with every device (docs/plans/log_explorer.md §7).
 */

// Heavy viz is console-only and lazy-loaded, so even the console's initial
// chunk stays lean; the Reachy target never imports @maxim/kit/viz at all.
const PlaceholderFlowPanel = lazy(() =>
  import('@maxim/kit/viz').then((m) => ({ default: m.PlaceholderFlowPanel })),
)

function ModelButtonLabel() {
  const { model } = useSelectedModel()
  return <>{model ?? 'model'} ▾</>
}

function ModelsDrawer({ close }: { close: () => void }) {
  const { model, setModel } = useSelectedModel()
  return (
    <ModelPicker
      value={model}
      onChange={(m) => {
        setModel(m.name)
        close()
      }}
    />
  )
}

function SettingsDrawer() {
  const [leaderUrl, setLeaderUrl] = useState('http://127.0.0.1:8099')
  const [showGraph, setShowGraph] = useState(false)
  return (
    <Stack className="gap-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Setup</h3>
        <SetupWizard />
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Developer
        </h3>
        <Stack className="gap-2">
          <label className="text-sm text-fg-muted" htmlFor="leader-url">
            Probe a leader URL
          </label>
          <input
            id="leader-url"
            className="w-full rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
            value={leaderUrl}
            onChange={(e) => setLeaderUrl(e.target.value)}
          />
          <ConnectionTest request={{ url: leaderUrl }} />
          <button
            className="self-start rounded-panel border border-edge bg-surface px-3 py-1 text-sm text-accent"
            onClick={() => setShowGraph(true)}
          >
            Load graph preview (heavy viz, lazy chunk)
          </button>
          {showGraph && (
            <Suspense fallback={<p className="text-fg-muted">loading viz chunk…</p>}>
              <PlaceholderFlowPanel />
            </Suspense>
          )}
        </Stack>
      </section>
    </Stack>
  )
}

export const consoleProfile: DeviceProfile = {
  id: 'console',
  // No stream filter: the Console renders the bio-tier activity and thinking rails.
  panels: CORE_PANELS,
  rails: { left: true, right: true },
  actions: [
    { id: 'models', label: 'Models', content: ModelButtonLabel, opens: 'models' },
    { id: 'memory', label: 'What Maxim remembers', content: '✦', togglesPanel: 'memory' },
    { id: 'logs', label: 'Logs', content: '≡', opens: 'logs' },
    { id: 'settings', label: 'Settings', content: '⚙', opens: 'settings' },
  ],
  links: [
    {
      label: 'Guides — docs.pymaxim.bio',
      href: 'https://docs.pymaxim.bio/getting-started/',
      content: '?',
    },
    {
      label: 'GitHub',
      href: 'https://github.com/dennys246/Maxim',
      // GitHub mark (octicon), currentColor so it follows the theme
      content: (
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="currentColor"
          aria-hidden="true"
          className="inline-block align-text-bottom"
        >
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
      ),
    },
  ],
  drawers: [
    { id: 'models', title: 'Models', render: (close) => <ModelsDrawer close={close} /> },
    { id: 'logs', title: 'Logs', wide: true, render: () => <LogsSurface /> },
    { id: 'settings', title: 'Settings', render: () => <SettingsDrawer /> },
  ],
  health: true,
}
