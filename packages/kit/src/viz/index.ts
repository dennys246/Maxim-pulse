/**
 * @maxim/kit/viz — the HEAVY entry (react-flow, later visx). Console-only.
 * The Reachy on-device bundle must never import this subpath (lint + the
 * `pnpm size:reachy` dist scan both enforce it). Consumers should lazy-load it:
 *   React.lazy(() => import('@maxim/kit/viz').then(m => ({ default: m.PlaceholderFlowPanel })))
 */
export { PlaceholderFlowPanel } from './PlaceholderFlowPanel'
