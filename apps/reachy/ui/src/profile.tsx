import { CORE_PANELS, SetupWizard, Stack, type DeviceProfile } from '@maxim/kit'

/**
 * The Reachy device profile. The robot page is an EXTENSION of the Console:
 * the same kit shell (auth, sign-in by ear, providers, top bar, chat core),
 * configured for a consumer on a Pi (docs/plans/log_explorer.md §7).
 *
 * LEAN bundle: this profile imports only the @maxim/kit root entry.
 * @maxim/kit/viz (react-flow/visx) is forbidden here — enforced by ESLint
 * no-restricted-imports and the `pnpm size:reachy` dist scan.
 *
 * The reachy_mini_app.md main page, over the shared chat surface: the three
 * flagship actions live in ChatSurface's input row (type = Talk,
 * 🎲 = Adventure, 😴 = Rest) over ONE persistent agent, with "what Maxim
 * remembers" alongside and setup behind the gear.
 */
export const reachyProfile: DeviceProfile = {
  id: 'reachy',
  // tier: 'clean' — this device renders conversation and memory, no bio-tier
  // surface, so the Pi never ships the idle loop's ~2/sec hippocampus+scn
  // chatter over the socket (~87% of the stream). Meta-kinds (run lifecycle,
  // identity, dropped) bypass the filter server-side, so TurnStatus and the
  // BackendChip keep working.
  subscribe: { tier: 'clean' },
  // Consumer-first panel set: memory only. The bio-activity and thinking rails
  // are a developer concern on a desk robot (reachy_mini_app.md moves debug
  // surfaces into a Developer drawer).
  panels: CORE_PANELS.filter((panel) => panel.id === 'memory'),
  rails: { left: false, right: true },
  actions: [
    { id: 'memory', label: 'What Maxim remembers', content: '✦', togglesPanel: 'memory' },
    { id: 'settings', label: 'Settings', content: '⚙', opens: 'settings' },
  ],
  links: [{ label: 'Guides — docs.pymaxim.bio', href: 'https://docs.pymaxim.bio/', content: '?' }],
  drawers: [
    {
      id: 'settings',
      title: 'Settings',
      render: () => (
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
      ),
    },
  ],
}
