import { PageShell, Panel, Row, Stack, StatusChip } from '@maxim/kit'

// LEAN bundle: this shell imports only the @maxim/kit root entry.
// @maxim/kit/viz (react-flow/visx) is forbidden here — enforced by ESLint
// no-restricted-imports and the `pnpm size:reachy` dist scan.
export default function App() {
  return (
    <PageShell title="Maxim on Reachy">
      <Stack>
        <Row>
          <StatusChip label="scaffold — not yet bound to the embodied HANDLE" tone="idle" />
        </Row>
        <Panel variant="scene">
          Phase-0 scaffold. SetupWizard / Talk / MemoryView land in Phase 2 (Reachy MVP).
        </Panel>
        <Panel variant="bio">bio-subsystem activity renders dimmed here (MaximDisplay IA).</Panel>
      </Stack>
    </PageShell>
  )
}
