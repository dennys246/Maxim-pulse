import { useState } from 'react'
import { useFacade } from '../facade/context'
import { FacadeError } from '../facade/http'
import type { ModelInfo, ProbeResult, SetupResult } from '../facade/types'
import { Panel, Stack } from '../design/primitives'
import { ConnectionTest } from './ConnectionTest'
import { ModelPicker } from './ModelPicker'

/**
 * SetupWizard — first-run mesh↔cloud choice, test, save (reachy_mini_app.md
 * screen map; maxim_console.md inventory). Binds SETUP + PROBE + list_models;
 * writes config only through the facade (never hand-rolled JSON), and only
 * after a passing test. Consumer copy carries no Maxim jargon — one choice,
 * mesh vs cloud.
 *
 * The shell decides *when* to show this (first run = no resolvable placement,
 * or Settings → re-run); `onComplete` fires with the facade's SetupResult.
 *
 * Cloud-path note: the wire ProbeRequest is mesh-shaped (`url` required), so
 * the cloud form currently saves without a pre-test — flagged to pymaxim; the
 * "cheap cloud-key probe" slot is ready once the contract grows a shape for it.
 */
export interface SetupWizardProps {
  onComplete?: (result: SetupResult) => void
}

type Screen = 'welcome' | 'mesh' | 'cloud' | 'done'

type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'unavailable'; detail: string }
  | { phase: 'error'; detail: string }

const DEFAULT_MONTHLY_BUDGET_USD = 5

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const facade = useFacade()
  const [screen, setScreen] = useState<Screen>('welcome')
  const [save, setSave] = useState<SaveState>({ phase: 'idle' })
  const [result, setResult] = useState<SetupResult | null>(null)

  // mesh form
  const [leaderUrl, setLeaderUrl] = useState('')
  const [meshKey, setMeshKey] = useState('')
  const [probe, setProbe] = useState<ProbeResult | null>(null)

  // cloud form
  const [cloudModel, setCloudModel] = useState<ModelInfo | null>(null)
  const [cloudKey, setCloudKey] = useState('')
  const [budget, setBudget] = useState(DEFAULT_MONTHLY_BUDGET_USD)

  const finish = (setupResult: SetupResult) => {
    setResult(setupResult)
    setScreen('done')
    setSave({ phase: 'idle' })
    onComplete?.(setupResult)
  }

  const runSave = async (write: () => Promise<SetupResult>) => {
    setSave({ phase: 'saving' })
    try {
      finish(await write())
    } catch (error) {
      if (error instanceof FacadeError && error.status === 501) {
        setSave({ phase: 'unavailable', detail: error.detail })
      } else {
        setSave({ phase: 'error', detail: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  if (screen === 'welcome') {
    return (
      <Stack>
        <h2 className="text-lg font-semibold text-scene-fg">Where should Maxim think?</h2>
        <button
          className="rounded-panel border border-edge bg-scene p-3 text-left text-scene-fg"
          onClick={() => setScreen('mesh')}
        >
          <span className="font-medium">Private &amp; free — use your own computer</span>
          <span className="block text-sm text-fg-muted">
            Run one command on a computer you own; Maxim connects to it.
          </span>
        </button>
        <button
          className="rounded-panel border border-edge bg-surface p-3 text-left text-fg"
          onClick={() => setScreen('cloud')}
        >
          <span className="font-medium">Easiest — connect a cloud key</span>
          <span className="block text-sm text-fg-muted">
            Paste an API key from a cloud provider. Costs per use.
          </span>
        </button>
      </Stack>
    )
  }

  if (screen === 'mesh') {
    return (
      <Stack>
        <h2 className="text-lg font-semibold text-scene-fg">Connect your computer</h2>
        <p className="text-sm text-fg-muted">
          On your computer, run <code className="font-mono">maxim</code> — it prints the address to
          paste here.
        </p>
        <label className="text-sm" htmlFor="setup-leader-url">
          Address
        </label>
        <input
          id="setup-leader-url"
          className="w-80 rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
          placeholder="https://… or http://192.168.x.x:8099"
          value={leaderUrl}
          onChange={(e) => {
            setLeaderUrl(e.target.value)
            setProbe(null)
          }}
        />
        <label className="text-sm" htmlFor="setup-mesh-key">
          Access key
        </label>
        <input
          id="setup-mesh-key"
          type="password"
          className="w-80 rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
          value={meshKey}
          onChange={(e) => {
            setMeshKey(e.target.value)
            setProbe(null)
          }}
        />
        <ConnectionTest
          request={{ url: leaderUrl, api_key: meshKey === '' ? null : meshKey }}
          onResult={setProbe}
        />
        <SaveRow
          state={save}
          disabled={probe?.status !== 'ok'}
          disabledHint="Test the connection first — Save unlocks on a passing test."
          onSave={() =>
            void runSave(() => facade.setupMesh({ leader_url: leaderUrl, api_key: meshKey }))
          }
          onBack={() => setScreen('welcome')}
        />
      </Stack>
    )
  }

  if (screen === 'cloud') {
    return (
      <Stack>
        <h2 className="text-lg font-semibold text-scene-fg">Connect a cloud key</h2>
        <ModelPicker
          value={cloudModel?.name}
          onChange={setCloudModel}
          filter={(model) => model.cloud}
        />
        <label className="text-sm" htmlFor="setup-cloud-key">
          API key
        </label>
        <input
          id="setup-cloud-key"
          type="password"
          className="w-80 rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
          value={cloudKey}
          onChange={(e) => setCloudKey(e.target.value)}
        />
        <label className="text-sm" htmlFor="setup-budget">
          Monthly spend cap (USD)
        </label>
        <input
          id="setup-budget"
          type="number"
          min={0}
          className="w-24 rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
        />
        <SaveRow
          state={save}
          disabled={cloudModel === null || cloudKey === ''}
          disabledHint="Pick a model and paste your key."
          onSave={() =>
            void runSave(() =>
              facade.setupCloud({
                provider: cloudModel!.backend,
                profile: cloudModel!.name,
                api_key: cloudKey,
                monthly_budget_usd: budget,
              }),
            )
          }
          onBack={() => setScreen('welcome')}
        />
      </Stack>
    )
  }

  return (
    <Panel variant="scene">
      <p className="font-medium">
        {result?.ok ? '✓ Maxim is set up.' : 'Setup finished with a problem.'}
      </p>
      {result != null && <p className="text-sm text-fg-muted">{result.detail}</p>}
    </Panel>
  )
}

function SaveRow({
  state,
  disabled,
  disabledHint,
  onSave,
  onBack,
}: {
  state: SaveState
  disabled: boolean
  disabledHint: string
  onSave: () => void
  onBack: () => void
}) {
  return (
    <Stack className="gap-2">
      <div className="flex gap-2">
        <button className="text-sm text-fg-muted" onClick={onBack}>
          ← Back
        </button>
        <button
          className="rounded-panel border border-edge bg-scene px-3 py-1 text-sm text-scene-fg disabled:opacity-50"
          disabled={disabled || state.phase === 'saving'}
          onClick={onSave}
        >
          {state.phase === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
      {disabled && <p className="text-xs text-fg-muted">{disabledHint}</p>}
      {state.phase === 'unavailable' && (
        <p className="text-sm text-fg-muted">Saving isn’t available yet: {state.detail}</p>
      )}
      {state.phase === 'error' && <p className="text-sm text-err">Save failed: {state.detail}</p>}
    </Stack>
  )
}
