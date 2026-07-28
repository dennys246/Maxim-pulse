import {
  ChatSurface,
  ConnectionTest,
  Drawer,
  LiveStatusChip,
  MemoryView,
  ModelPicker,
  SetupWizard,
  Stack,
  TopBar,
  TopBarButton,
  TopBarLink,
} from '@maxim/kit'
import { lazy, Suspense, useState } from 'react'

// Heavy viz is console-only and lazy-loaded, so even the console's initial
// chunk stays lean; the Reachy target never imports @maxim/kit/viz at all.
const PlaceholderFlowPanel = lazy(() =>
  import('@maxim/kit/viz').then((m) => ({ default: m.PlaceholderFlowPanel })),
)

type OpenSurface = 'none' | 'models' | 'memory' | 'settings'

export default function App() {
  const [open, setOpen] = useState<OpenSurface>('none')
  const [model, setModel] = useState<string | undefined>()
  const [leaderUrl, setLeaderUrl] = useState('http://127.0.0.1:8099')
  const [showGraph, setShowGraph] = useState(false)

  const toggle = (surface: OpenSurface) => setOpen((prev) => (prev === surface ? 'none' : surface))

  return (
    <div className="flex h-screen flex-col bg-bg font-sans text-fg">
      <TopBar
        left={<LiveStatusChip />}
        right={
          <>
            <TopBarButton label="Models" onClick={() => toggle('models')}>
              {model ?? 'model'} ▾
            </TopBarButton>
            <TopBarButton label="What Maxim remembers" onClick={() => toggle('memory')}>
              ✦
            </TopBarButton>
            <TopBarButton label="Settings" onClick={() => toggle('settings')}>
              ⚙
            </TopBarButton>
            <TopBarLink
              label="Guides — docs.pymaxim.bio"
              href="https://docs.pymaxim.bio/getting-started/"
            >
              ?
            </TopBarLink>
            <TopBarLink label="GitHub" href="https://github.com/dennys246/Maxim">
              ↗
            </TopBarLink>
          </>
        }
      />

      {/* the landing IS the chat — solo-mode users start here, no gauntlet */}
      <main className="min-h-0 flex-1">
        <ChatSurface />
      </main>

      <Drawer open={open === 'models'} title="Models" onClose={() => setOpen('none')}>
        <ModelPicker
          value={model}
          onChange={(m) => {
            setModel(m.name)
            setOpen('none')
          }}
        />
      </Drawer>

      <Drawer
        open={open === 'memory'}
        title="✦ What Maxim remembers about you"
        onClose={() => setOpen('none')}
      >
        <MemoryView />
      </Drawer>

      <Drawer open={open === 'settings'} title="Settings" onClose={() => setOpen('none')}>
        <Stack className="gap-4">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Setup
            </h3>
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
      </Drawer>
    </div>
  )
}
