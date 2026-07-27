import { LiveStatusChip, MemoryView, Panel, PageShell, Row, RunSurface, Stack } from '@maxim/kit'

// LEAN bundle: this shell imports only the @maxim/kit root entry.
// @maxim/kit/viz (react-flow/visx) is forbidden here — enforced by ESLint
// no-restricted-imports and the `pnpm size:reachy` dist scan.
//
// The reachy_mini_app.md main page: three flagship actions over ONE
// persistent agent + "what Maxim remembers about you" + the status chip.
// (SetupWizard mounts on first run once the shell reads config state — Phase-2
// bootstrap work in maxim_reachy_app.)
export default function App() {
  return (
    <PageShell title="Maxim on Reachy">
      <Stack>
        <Row>
          <LiveStatusChip />
        </Row>
        <RunSurface modes={['adventure', 'talk', 'rest']} />
        <Panel variant="bio">
          <h2 className="mb-2 text-sm font-semibold text-scene-fg">
            ✦ What Maxim remembers about you
          </h2>
          <MemoryView />
        </Panel>
      </Stack>
    </PageShell>
  )
}
