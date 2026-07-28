import { useEffect, useRef, useState } from 'react'
import { useFacade } from '../facade/context'
import { FacadeError } from '../facade/http'
import type { ConsoleEvent, RunRequest } from '../facade/types'
import { AdventureLauncher } from './AdventureLauncher'

/**
 * ChatSurface — the chat-first landing: the ported MaximDisplay spread as a
 * single surface. Conversation renders BRIGHT (scene); bio-subsystem activity
 * renders DIMMED underneath (bio) as a collapsible ticker; a thinking slot
 * sits between them. All input rides the HANDLE seam (`POST /api/run`) and
 * the /ws event stream — no back-channels.
 *
 * Until pymaxim's Phase-3 streaming bridge: talk/rest answer typed 501s
 * (rendered as gentle system lines), adventure runs for real (narrative in
 * the serve terminal), and the ticker shows whatever /ws sends (heartbeats
 * today — a liveness signal; the full api.on() stream drops in unchanged).
 */

interface ChatLine {
  role: 'user' | 'maxim' | 'system'
  text: string
}

const lineStyle: Record<ChatLine['role'], string> = {
  user: 'text-fg',
  maxim: 'text-scene-fg',
  system: 'text-fg-muted italic',
}

// 🎲 opens the AdventureLauncher (campaign path or free-text idea) — the
// surface needs no shell-provided props.
export function ChatSurface() {
  const facade = useFacade()
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [lines, setLines] = useState<ChatLine[]>([
    { role: 'system', text: 'Maxim is listening. Say something, or start an 🎲 Adventure.' },
  ])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<ConsoleEvent[]>([])
  const [showActivity, setShowActivity] = useState(false)
  const [thinking, setThinking] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offAll = facade.on('*', (event) => {
      setActivity((prev) => [...prev.slice(-49), event])
      if (event.kind === 'thinking') {
        const text = typeof event.data?.text === 'string' ? event.data.text : event.kind
        setThinking((prev) => [...prev.slice(-19), text])
      }
    })
    return offAll
  }, [facade])

  useEffect(() => {
    // optional-call: jsdom has no scrollTo
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
  }, [lines])

  const push = (line: ChatLine) => setLines((prev) => [...prev, line])

  const start = async (request: RunRequest) => {
    setBusy(true)
    try {
      const accepted = await facade.run(request)
      if (request.mode === 'adventure') {
        push({
          role: 'system',
          text: `🎲 Adventure ${accepted.status} · run ${accepted.session_id}. The narrative streams in the maxim serve terminal until the event bridge lands.`,
        })
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
          text:
            request.mode === 'talk'
              ? 'Maxim can’t hold a live conversation here yet — that arrives with the event bridge. 🎲 Adventure works today.'
              : `${request.mode} isn’t available yet: ${error.detail}`,
        })
      } else if (error instanceof FacadeError && error.status === 422) {
        if (request.mode === 'adventure' && request.campaign == null && request.input != null) {
          // idea-only launch: the generative-adventure seam hasn't landed yet
          push({
            role: 'system',
            text: 'Maxim can’t imagine an adventure from a description yet — that seam is on its way. Pick a campaign YAML in the 🎲 launcher meanwhile.',
          })
        } else {
          push({ role: 'system', text: `Couldn’t start: ${error.detail}` })
        }
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
    setDraft('')
    void start({ mode: 'talk', input: text })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* conversation — scene-bright */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-scene p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {lines.map((line, index) => (
            <p key={index} className={`text-sm ${lineStyle[line.role]}`}>
              {line.role === 'user' && <span className="text-fg-muted">you · </span>}
              {line.text}
            </p>
          ))}
        </div>
      </div>

      {/* thinking — appears when the stream carries it */}
      {thinking.length > 0 && (
        <div className="border-t border-edge bg-bio px-4 py-2">
          <p className="text-xs text-bio-fg">thinking · {thinking[thinking.length - 1]}</p>
        </div>
      )}

      {/* bio activity ticker — dimmed, collapsible */}
      <div className="border-t border-edge bg-bio px-4 py-1">
        <button
          className="text-xs text-bio-fg hover:text-fg-muted"
          onClick={() => setShowActivity((v) => !v)}
        >
          {showActivity ? '▾' : '▸'} bio activity ({activity.length})
        </button>
        {showActivity && (
          <ul className="max-h-32 overflow-y-auto py-1" data-testid="bio-ticker">
            {activity.slice(-12).map((event, index) => (
              <li key={index} className="font-mono text-xs text-bio-fg">
                {event.kind}
                {event.agent_id != null && ` · ${event.agent_id}`}
              </li>
            ))}
          </ul>
        )}
      </div>

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
