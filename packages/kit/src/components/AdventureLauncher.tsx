import { useState } from 'react'
import type { RunRequest } from '../facade/types'

/**
 * AdventureLauncher — the 🎲 popup: pick a campaign or describe one.
 *
 * Today: a campaign YAML path launches for real; the "describe an adventure"
 * idea rides RunRequest.input (the `--sim "…"` precedent) and the server
 * answers 422 until the generative-adventure seam lands — ChatSurface surfaces
 * that detail as a gentle line, so this UI is contract-honest either way.
 *
 * When pymaxim ships the CAMPAIGNS listing seam, the path input upgrades to a
 * dropdown of every available campaign (this component is where it lands).
 */
export function AdventureLauncher({
  open,
  onClose,
  onLaunch,
}: {
  open: boolean
  onClose: () => void
  onLaunch: (request: RunRequest) => void
}) {
  const [campaign, setCampaign] = useState('')
  const [idea, setIdea] = useState('')
  if (!open) return null

  const canLaunch = campaign.trim() !== '' || idea.trim() !== ''
  const launch = () => {
    const path = campaign.trim()
    const ideaText = idea.trim()
    onLaunch({
      mode: 'adventure',
      campaign: path === '' ? null : path,
      input: ideaText === '' ? null : ideaText,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        data-testid="launcher-backdrop"
      />
      <div
        role="dialog"
        aria-label="Start an Adventure"
        className="relative z-10 w-full max-w-lg rounded-panel border border-edge bg-bg p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-scene-fg">🎲 Start an Adventure</h2>
          <button
            aria-label="Close launcher"
            className="rounded-panel border border-edge bg-surface px-2 py-0.5 text-sm text-fg"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <label className="text-sm text-fg-muted" htmlFor="launcher-campaign">
          Play a campaign (YAML path — a picker arrives with the campaign-list seam)
        </label>
        <input
          id="launcher-campaign"
          className="mt-1 w-full rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
          placeholder="~/Scripts/Maxim/scenarios/campaigns/darkened_cavern_v1.yaml"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
        />

        <p className="my-3 text-center text-xs text-fg-muted">— or —</p>

        <label className="text-sm text-fg-muted" htmlFor="launcher-idea">
          Describe an adventure and let Maxim imagine it
        </label>
        <textarea
          id="launcher-idea"
          rows={3}
          className="mt-1 w-full rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
          placeholder="A heist on a sky-fortress during a lightning storm…"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-panel border border-edge bg-surface px-3 py-1 text-sm text-fg"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-panel border border-edge bg-scene px-3 py-1 text-sm text-scene-fg disabled:opacity-50"
            disabled={!canLaunch}
            onClick={launch}
          >
            Begin
          </button>
        </div>
      </div>
    </div>
  )
}
