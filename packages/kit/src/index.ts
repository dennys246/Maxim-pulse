/**
 * @maxim/kit — the LEAN entry. This is the ONLY kit entry the Reachy on-device
 * bundle may import. Heavy dashboard viz lives behind the separate `@maxim/kit/viz`
 * subpath export and must never be re-exported here (AGENTS.md § code-split).
 */
export { ThemeProvider, useTheme, type Theme } from './design/ThemeProvider'
export { PageShell, Panel, Stack, Row } from './design/primitives'
export { TopBar, TopBarButton, TopBarLink } from './design/TopBar'
export { Drawer } from './design/Drawer'
export { StatusChip, type StatusChipProps } from './components/StatusChip'
export { ConnectionTest, type ConnectionTestProps } from './components/ConnectionTest'
export { ModelPicker, type ModelPickerProps } from './components/ModelPicker'
export { SetupWizard, type SetupWizardProps } from './components/SetupWizard'
export { LiveStatusChip } from './components/LiveStatusChip'
export { MemoryView } from './components/MemoryView'
export { RunSurface, type RunSurfaceProps } from './components/RunSurface'
export { ChatSurface } from './components/ChatSurface'
export { AdventureLauncher } from './components/AdventureLauncher'
export * from './facade'
