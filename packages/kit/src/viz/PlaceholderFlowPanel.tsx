import { Background, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

/**
 * Placeholder react-flow panel — the deliberate HEAVY payload that makes the
 * Phase-0 code-split guard real: the console lazy-loads this, and
 * `pnpm size:reachy` asserts none of it reaches the Reachy on-device bundle.
 * Replaced by the real NAc/EC/provenance graph panels in Phase 5.
 */
const nodes = [
  { id: 'nac', position: { x: 0, y: 0 }, data: { label: 'NAc' } },
  { id: 'ec', position: { x: 180, y: 90 }, data: { label: 'EC' } },
]
const edges = [{ id: 'nac-ec', source: 'nac', target: 'ec' }]

export function PlaceholderFlowPanel() {
  return (
    <div style={{ height: 240 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
      </ReactFlow>
    </div>
  )
}
