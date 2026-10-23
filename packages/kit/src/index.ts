/**
 * @maxim/kit — the LEAN entry. This is the ONLY kit entry the Reachy on-device
 * bundle may import. Heavy dashboard viz lives behind the separate `@maxim/kit/viz`
 * subpath export and must never be re-exported here (AGENTS.md § code-split).
 */
export { ThemeProvider, useTheme, type Theme } from './design/ThemeProvider'
export { PageShell, Panel, Stack, Row, Cmd, CmdBlock } from './design/primitives'
export { TopBar, TopBarButton, TopBarLink } from './design/TopBar'
export { Drawer } from './design/Drawer'
export { StatusChip, type StatusChipProps } from './components/StatusChip'
export { ConnectionTest, type ConnectionTestProps } from './components/ConnectionTest'
export { ModelPicker, type ModelPickerProps } from './components/ModelPicker'
export { SetupWizard, type SetupWizardProps } from './components/SetupWizard'
export { LiveStatusChip } from './components/LiveStatusChip'
export { BackendChip } from './components/BackendChip'
export { DiagnosticsPanel } from './components/DiagnosticsPanel'
export { MemoryView } from './components/MemoryView'
export { RunSurface, type RunSurfaceProps } from './components/RunSurface'
export { ChatSurface, type ChatSurfaceProps } from './components/ChatSurface'
export { TurnStatus } from './components/TurnStatus'
export { AdventureLauncher } from './components/AdventureLauncher'
export { PanelProvider, PanelRail, usePanelDock, type PanelSpec } from './components/PanelDock'
export { ActivityPanel, ThinkingPanel, CORE_PANELS } from './components/panels'
export {
  EventClientProvider,
  EventHub,
  useEventClient,
  useEvents,
  type EventFilter,
} from './facade/eventClient'
export { IdentityProvider, useIdentity } from './facade/identity'
export {
  AuthGate,
  AuthSessionProvider,
  useAuthSession,
  useAuthSnapshot,
  type AuthGateProps,
} from './components/AuthGate'
export { LoginScreen, type LoginScreenProps } from './components/LoginScreen'
export * from './facade'
export * from './shell'
export { LogsSurface } from './components/logs/LogsSurface'
export { HealthStrip, HealthTab, DegradedTab } from './components/logs/HealthViews'
export { RunsTab } from './components/logs/RunsTab'
export { CreditChip } from './components/logs/CreditChip'
