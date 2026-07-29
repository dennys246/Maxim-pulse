import { useEffect, useState } from 'react'
import { useFacade } from '../facade/context'
import type { CampaignInfo, RunRequest } from '../facade/types'

/**
 * AdventureLauncher — the 🎲 popup: pick a campaign the server offers, or
 * describe a premise and let Maxim imagine one.
 *
 * Both paths are live: `GET /api/campaigns` lists what the server can run
 * (the shell never types paths), and `mode="adventure"` accepts EXACTLY ONE of
 * `campaign` (an authored YAML) or `input` (a free-text premise).
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
  const facade = useFacade()
  const [campaigns, setCampaigns] = useState<CampaignInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chosen, setChosen] = useState('')
  const [idea, setIdea] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    facade
      .listCampaigns()
      .then((response) => {
        if (alive) setCampaigns(response.campaigns ?? [])
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [facade, open])

  if (!open) return null

  // The server requires exactly one — mirror that so a doomed request is
  // impossible rather than merely reported.
  const hasCampaign = chosen !== ''
  const hasIdea = idea.trim() !== ''
  const canLaunch = hasCampaign !== hasIdea

  const launch = () => {
    onLaunch({
      mode: 'adventure',
      campaign: hasCampaign ? chosen : null,
      input: hasIdea ? idea.trim() : null,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        aria-hidden
        className="absolute inset-0 bg-overlay"
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
          Play a campaign
        </label>
        <select
          id="launcher-campaign"
          className="mt-1 w-full rounded-panel border border-edge bg-bio px-2 py-1 text-sm text-fg"
          value={chosen}
          disabled={hasIdea}
          onChange={(event) => setChosen(event.target.value)}
        >
          <option value="">
            {campaigns == null
              ? loadError == null
                ? 'Loading campaigns…'
                : 'Campaigns unavailable'
              : campaigns.length === 0
                ? 'No campaigns found'
                : 'Choose a campaign…'}
          </option>
          {campaigns?.map((campaign) => (
            <option key={campaign.path} value={campaign.path}>
              {campaign.name}
              {campaign.source === 'user' ? ' (yours)' : ''}
            </option>
          ))}
        </select>
        {loadError != null && (
          <p className="mt-1 text-xs text-err">Couldn’t list campaigns: {loadError}</p>
        )}

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
          disabled={hasCampaign}
          onChange={(event) => setIdea(event.target.value)}
        />

        <div className="mt-4 flex items-center justify-end gap-2">
          {hasCampaign && hasIdea && (
            <p className="mr-auto text-xs text-fg-muted">Pick one: a campaign or a premise.</p>
          )}
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
