import { useState } from 'react'
import { Gated } from '../../shell/ConsoleApp'
import { DegradedTab, HealthTab } from './HealthViews'
import { RunsTab } from './RunsTab'

type Tab = 'runs' | 'degraded' | 'health'

const TABS: Array<{ id: Tab; label: string; seam: string }> = [
  { id: 'runs', label: 'Runs', seam: 'runs' },
  { id: 'degraded', label: 'Degraded', seam: 'degraded' },
  { id: 'health', label: 'Health', seam: 'health' },
]

const NEEDS_060 = 'This needs a backend speaking console contract 0.6.0 (pymaxim newer than 1.3.1).'

/**
 * LogsSurface — explore what the agent did and why (docs/plans/log_explorer.md).
 * Plain DOM, in the lean kit entry, so every device profile can carry it.
 * Each tab is gated on its own seam: an older backend gets "needs 0.6.0", a
 * server that declares the seam closed gets the server's own reason — never a
 * blank panel.
 */
export function LogsSurface() {
  const [tab, setTab] = useState<Tab>('runs')
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Logs" className="flex flex-row gap-1 border-b border-edge">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`px-3 py-1 text-sm ${tab === t.id ? 'border-b-2 border-accent text-scene-fg' : 'text-fg-muted'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {TABS.filter((t) => t.id === tab).map((t) => (
          <Gated key={t.id} requirement={{ requires: [t.seam], missing: NEEDS_060 }}>
            {t.id === 'runs' ? <RunsTab /> : t.id === 'degraded' ? <DegradedTab /> : <HealthTab />}
          </Gated>
        ))}
      </div>
    </div>
  )
}
