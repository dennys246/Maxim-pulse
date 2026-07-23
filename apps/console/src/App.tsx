import { PageShell, Panel, Row, Stack, StatusChip } from '@maxim/kit'
import { lazy, Suspense, useState } from 'react'

// Heavy viz is console-only and lazy-loaded, so even the console's initial
// chunk stays lean; the Reachy target never imports @maxim/kit/viz at all.
const PlaceholderFlowPanel = lazy(() =>
  import('@maxim/kit/viz').then((m) => ({ default: m.PlaceholderFlowPanel })),
)

export default function App() {
  const [showGraph, setShowGraph] = useState(false)

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
