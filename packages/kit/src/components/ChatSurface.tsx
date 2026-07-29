import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useFacade } from '../facade/context'
import { useEventClient } from '../facade/eventClient'
import { FacadeError } from '../facade/http'
import type { RunRequest } from '../facade/types'
import { AdventureLauncher } from './AdventureLauncher'

/**
 * ChatSurface — the core of the MaximDisplay IA port: conversation/narrative
 * BRIGHT (scene) + input. Bio-activity and thinking now live as PanelDock
 * rail panels beside this core (the terminal's two-column body); this surface
 * stays the constant center. All input rides the HANDLE seam — no
 * back-channels.
 *
 * The transcript is stream-driven: `handle.talk` publishes the utterance and
 * the reply as clean-tier records, which this surface renders (echoing the
 * local utterance immediately and deduping its record). Requires
 * <EventClientProvider>.
 */

interface ChatLine {
  /** Stable identity — array indices mis-key once stream lines interleave. */
  id: number
  role: 'user' | 'maxim' | 'system'
  text: string
}

/**
 * Conversation kinds on the wire (lowercased sim_log subsystems). `handle.talk`
 * emits USER for the utterance and RESPONSE for the reply — the web chat echoes
 * its own utterance locally for immediacy and dedupes the USER record.
 *
 * Adventure narration is NOT here: pymaxim's DM narrates through display_scene,
 * which bypasses sim_log entirely, so SCENE/NPC/CHOICE reach no stream (flagged
 * to pymaxim). Campaign prose stays in the serve terminal until that lands.
 */
const REPLY_KIND = 'response'
const UTTERANCE_KIND = 'user'

const lineStyle: Record<ChatLine['role'], string> = {
  user: 'text-fg',
  maxim: 'text-scene-fg',
  system: 'text-fg-muted italic',
}

export interface ChatSurfaceProps {
  /**
   * Rendered between the conversation and the input row — the shell's slot for
   * run/turn state (e.g. <TurnStatus />). A slot rather than a direct import so
   * this surface keeps its provider-free contract (facade only).
   */
  statusSlot?: ReactNode
}

// 🎲 opens the AdventureLauncher (campaign path or free-text idea).
export function ChatSurface({ statusSlot }: ChatSurfaceProps = {}) {
  const facade = useFacade()
  const hub = useEventClient()
  const [launcherOpen, setLauncherOpen] = useState(false)
  const nextId = useRef(0)
  const [lines, setLines] = useState<ChatLine[]>([
    {
      id: -1,
      role: 'system',
      text: 'Maxim is listening. Say something, or start an 🎲 Adventure.',
    },
  ])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Utterances echoed locally, awaiting their USER record so we can drop it. */
  const pendingEcho = useRef<string[]>([])
  /**
   * Replies already shown. talk delivers each reply TWICE — synchronously as
   * RunAccepted.reply and on the stream as a RESPONSE record — and either can
   * arrive first (or alone, if the socket dropped). First one wins.
   */
  const shownReplies = useRef<string[]>([])

  useEffect(() => {
    // optional-call: jsdom has no scrollTo
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
  }, [lines])

  const push = (line: Omit<ChatLine, 'id'>) =>
    setLines((prev) => [...prev, { ...line, id: nextId.current++ }])

  /** True if this reply text has not been rendered yet (and claims it). */
  const claimReply = (text: string) => {
    const at = shownReplies.current.indexOf(text)
    if (at !== -1) {
      shownReplies.current.splice(at, 1) // the other delivery path already showed it
      return false
    }
    shownReplies.current.push(text)
    return true
  }

  // The transcript subscribes to the hub DIRECTLY and keeps its own append-only
  // state — never useEvents, whose window caps at `limit` and rebuilds from a
  // 200-event ring shared with bio-tier noise (a long session would silently
  // lose its own opening lines).
  useEffect(
    () =>
      hub.listen((event) => {
        if (event.kind === REPLY_KIND) {
          if (!claimReply(event.message)) return
          push({ role: 'maxim', text: event.message })
        } else if (event.kind === UTTERANCE_KIND) {
          const echoed = pendingEcho.current.indexOf(event.message)
          if (echoed !== -1) {
            pendingEcho.current.splice(echoed, 1) // our own line, already shown
          } else {
            push({ role: 'user', text: event.message })
          }
        }
      }),
    [hub],
  )

  const start = async (request: RunRequest) => {
    setBusy(true)
    try {
      const accepted = await facade.run(request)
      if (request.mode === 'adventure') {
        push({
          role: 'system',
          text: `🎲 Adventure ${accepted.status} · run ${accepted.session_id}. Narration prints in the maxim serve terminal — the DM narrates outside the record stream (flagged to pymaxim); thinking and bio activity are live in the rails.`,
        })
      } else if (request.mode === 'talk') {
        const reply = accepted.reply
        if (reply != null && reply !== '' && claimReply(reply)) {
          push({ role: 'maxim', text: reply })
        }
      } else {
        push({
          role: 'system',
          text: `${request.mode} ${accepted.status} · run ${accepted.session_id}`,
        })
      }
    } catch (error) {
      if (error instanceof FacadeError && error.status === 501) {
        push({
          role: 'system',
          text: `${request.mode} isn’t available yet: ${error.detail}`,
        })
      } else if (error instanceof FacadeError && error.status === 422) {
        push({ role: 'system', text: `Couldn’t start: ${error.detail}` })
      } else {
        push({
          role: 'system',
          text: `Something went wrong: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    const text = draft.trim()
    if (text === '' || busy) return
    push({ role: 'user', text })
    pendingEcho.current.push(text) // drop the USER record that echoes this back
    setDraft('')
    void start({ mode: 'talk', input: text })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* conversation — scene-bright */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-scene p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {lines.map((line) => (
            <p key={line.id} className={`text-sm ${lineStyle[line.role]}`}>
              {line.role === 'user' && <span className="text-fg-muted">you · </span>}
              {line.text}
            </p>
          ))}
        </div>
      </div>

      {statusSlot}

      {/* input row */}
      <div className="flex items-center gap-2 border-t border-edge bg-surface p-3">
        <input
          aria-label="Say something to Maxim"
          className="min-w-0 flex-1 rounded-panel border border-edge bg-bio px-3 py-2 text-sm text-fg"
          placeholder="Say something…"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button
          aria-label="Send"
          className="rounded-panel border border-edge bg-scene px-3 py-2 text-sm text-scene-fg disabled:opacity-50"
          disabled={busy || draft.trim() === ''}
          onClick={submit}
        >
          ➤
        </button>
        <button
          aria-label="Start Adventure"
          title="Start Adventure"
          className="rounded-panel border border-edge bg-surface px-3 py-2 text-sm disabled:opacity-50"
          disabled={busy}
          onClick={() => setLauncherOpen(true)}
        >
          🎲
        </button>
        <button
          aria-label="Rest"
          title="Rest"
          className="rounded-panel border border-edge bg-surface px-3 py-2 text-sm disabled:opacity-50"
          disabled={busy}
          onClick={() => void start({ mode: 'rest' })}
        >
          😴
        </button>
      </div>

      <AdventureLauncher
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        onLaunch={(request) => void start(request)}
      />
    </div>
  )
}
