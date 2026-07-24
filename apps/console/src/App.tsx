import {
  ConnectionTest,
  ModelPicker,
  PageShell,
  Panel,
  Row,
  SetupWizard,
  Stack,
  StatusChip,
} from '@maxim/kit'
import { lazy, Suspense, useState } from 'react'

// Heavy viz is console-only and lazy-loaded, so even the console's initial
// chunk stays lean; the Reachy target never imports @maxim/kit/viz at all.
const PlaceholderFlowPanel = lazy(() =>
  import('@maxim/kit/viz').then((m) => ({ default: m.PlaceholderFlowPanel })),
)

export default function App() {
  const [showGraph, setShowGraph] = useState(false)
  const [leaderUrl, setLeaderUrl] = useState('http://127.0.0.1:8099')
  const [model, setModel] = useState<string | undefined>()
  const [showSetup, setShowSetup] = useState(false)

  return (
    <PageShell title="Maxim Console">
      <Stack>
        <Row>
          <StatusChip label="scaffold — not yet bound to maxim serve" tone="idle" />
        </Row>
        <Panel variant="scene">
          Phase-0 scaffold. Kit components land in Phase 2; console-only panels in Phase 3.
        </Panel>
        <Panel variant="bio">bio-subsystem activity renders dimmed here (MaximDisplay IA).</Panel>
        <Panel>
          <Stack className="gap-2">
            <label className="text-sm text-fg-muted" htmlFor="leader-url">
              Leader URL (PROBE seam demo — live against maxim serve)
            </label>
            <input
              id="leader-url"
              className="w-72 rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
              value={leaderUrl}
              onChange={(e) => setLeaderUrl(e.target.value)}
            />
            <ConnectionTest request={{ url: leaderUrl }} />
          </Stack>
        </Panel>
        <Panel>
          <Stack className="gap-2">
            <p className="text-sm text-fg-muted">
              Model profiles (live from /api/models){model != null && ` — selected: ${model}`}
            </p>
            <ModelPicker value={model} onChange={(m) => setModel(m.name)} />
          </Stack>
        </Panel>
        <Panel>
          <button
            className="rounded-panel border border-edge bg-surface px-3 py-1 text-sm text-accent"
            onClick={() => setShowSetup((v) => !v)}
          >
            {showSetup ? 'Hide setup' : 'Run setup'}
          </button>
          {showSetup && (
            <div className="mt-3">
              <SetupWizard />
            </div>
          )}
        </Panel>
        <Panel>
          <button
            className="rounded-panel border border-edge bg-surface px-3 py-1 text-sm text-accent"
            onClick={() => setShowGraph(true)}
          >
            Load graph preview (heavy viz, lazy chunk)
          </button>
          {showGraph && (
            <Suspense fallback={<p className="mt-2 text-fg-muted">loading viz chunk…</p>}>
              <PlaceholderFlowPanel />
            </Suspense>
          )}
        </Panel>
      </Stack>
    </PageShell>
  )
}
