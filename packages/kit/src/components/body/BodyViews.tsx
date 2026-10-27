import {
  comfort,
  rangeFraction,
  type BodyView,
  type ComponentOption,
  type Embodiment,
  type ModulatorView,
  type PartView,
  type SensationView,
  type SensorView,
} from './model'

/**
 * The Body & Environment views (docs/plans/body_environment.md). Pure: every view
 * renders props only and calls no facade, so the same views serve the live panel,
 * the website Demo, and a future lab. Plain DOM — this stays in the lean kit entry;
 * a body DIAGRAM would live behind `@maxim/kit/viz`.
 *
 * All text that originates in a component definition (names, descriptions,
 * sensation summaries) is author-controlled: it renders as React text, never HTML.
 */

const EMBODIMENT: Record<Embodiment, { label: string; title: string; tone: string }> = {
  none: {
    label: 'No body',
    title: 'Maxim has no body in this session.',
    tone: 'border-edge text-fg-muted',
  },
  simulated: {
    label: 'Simulated body',
    title: 'Actions report success, but nothing moves.',
    tone: 'border-accent text-accent',
  },
  hardware: {
    label: 'Live hardware',
    title: 'Actions move a real body.',
    tone: 'border-warn text-warn',
  },
}

export function EmbodimentChip({ embodiment }: { embodiment: Embodiment }) {
  const e = EMBODIMENT[embodiment]
  return (
    <span
      role="note"
      title={e.title}
      aria-label={`${e.label}: ${e.title}`}
      className={`inline-flex rounded-panel border px-1.5 py-0.5 text-xs ${e.tone}`}
    >
      {e.label}
    </span>
  )
}

const fmt = (value: number) =>
  Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(2).replace(/\.?0+$/, '')

export function SensorRow({ sensor }: { sensor: SensorView }) {
  const at = rangeFraction(sensor.value, sensor.range)
  const band = sensor.drive?.comfortBand ?? null
  const bandFrom = band !== null ? rangeFraction(band[0], sensor.range) : null
  const bandTo = band !== null ? rangeFraction(band[1], sensor.range) : null
  const state = comfort(sensor)
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-fg">{sensor.name}</span>
        {sensor.value === null ? (
          <span className="text-fg-muted">unreadable</span>
        ) : (
          <span className={state === 'outside' ? 'text-warn' : 'text-fg-muted'}>
            {fmt(sensor.value)}
            {sensor.unit !== '' ? ` ${sensor.unit}` : ''}
            {state === 'outside' ? ' · outside comfort' : ''}
          </span>
        )}
      </div>
      <div
        role="meter"
        aria-label={`${sensor.name} within its range`}
        aria-valuemin={sensor.range[0]}
        aria-valuemax={sensor.range[1]}
        aria-valuenow={sensor.value ?? undefined}
        className="relative h-1.5 rounded-panel bg-bio"
      >
        {bandFrom !== null && bandTo !== null && (
          <div
            data-testid="comfort-band"
            className="absolute inset-y-0 bg-ok/30"
            style={{ left: `${bandFrom * 100}%`, width: `${(bandTo - bandFrom) * 100}%` }}
          />
        )}
        {at !== null && (
          <div
            className={`absolute inset-y-0 w-1 -translate-x-1/2 rounded-panel ${
              state === 'outside' ? 'bg-warn' : 'bg-accent'
            }`}
            style={{ left: `${at * 100}%` }}
          />
        )}
      </div>
    </li>
  )
}

function ModulatorRow({ modulator }: { modulator: ModulatorView }) {
  return (
    <li className="text-xs">
      <span className="text-fg">{modulator.name}</span>
      {modulator.integrity !== null && (
        <span
          className={modulator.integrity < 1 ? 'text-warn' : 'text-fg-muted'}
        >{` · ${Math.round(modulator.integrity * 100)}% intact`}</span>
      )}
      {modulator.abilities.length > 0 && (
        <ul className="mt-0.5 flex flex-wrap gap-1">
          {modulator.abilities.map((ability) => (
            <li
              key={ability.name}
              title={ability.reason ?? undefined}
              className={`rounded-panel border px-1 ${
                ability.available === false
                  ? 'border-err text-err line-through'
                  : ability.available === true
                    ? 'border-ok text-fg'
                    : 'border-edge text-fg-muted'
              }`}
            >
              {ability.name}
              {ability.available === false && ability.reason !== null && (
                <span className="sr-only">{` (unavailable: ${ability.reason})`}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** One part and everything under it. Open at the top two levels. */
export function PartNode({ part, depth = 0 }: { part: PartView; depth?: number }) {
  return (
    <details open={depth < 2} className="flex flex-col gap-1">
      <summary className="cursor-pointer text-sm text-fg">
        {part.name}
        <span className="text-xs text-fg-muted">{` ${part.kind}`}</span>
        {part.failures.length > 0 && (
          <span className="text-xs text-err">{` · ${part.failures.length} failing`}</span>
        )}
      </summary>
      <div className="ml-3 flex flex-col gap-2 border-l border-edge pl-2">
        {part.failures.length > 0 && (
          <ul aria-label={`${part.name} failures`} className="text-xs text-err">
            {part.failures.map((f) => (
              <li key={f.name}>
                {f.name}
                {f.pain !== null ? ` (pain ${fmt(f.pain)})` : ''}
              </li>
            ))}
          </ul>
        )}
        {part.sensors.length > 0 && (
          <ul aria-label={`${part.name} sensors`} className="flex flex-col gap-1.5">
            {part.sensors.map((s) => (
              <SensorRow key={s.name} sensor={s} />
            ))}
          </ul>
        )}
        {part.modulators.length > 0 && (
          <ul aria-label={`${part.name} abilities`} className="flex flex-col gap-1">
            {part.modulators.map((m) => (
              <ModulatorRow key={m.name} modulator={m} />
            ))}
          </ul>
        )}
        {part.children.map((child) => (
          <PartNode key={child.path.join('\u0000')} part={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  )
}

export interface ComponentPickerProps {
  label: string
  options: ComponentOption[]
  /** The selected ref, or null for none. */
  value: string | null
  onChange: (ref: string | null) => void
  /** Offer a "None" entry (scenes; a body dropdown in preview). */
  noneLabel?: string
  disabled?: boolean
}

/** The body / scene dropdown. A user component is badged until the server validates it. */
export function ComponentPicker({
  label,
  options,
  value,
  onChange,
  noneLabel,
  disabled,
}: ComponentPickerProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      {label}
      <select
        className="min-w-0 flex-1 rounded-panel border border-edge bg-surface px-1 py-0.5 text-fg"
        value={value ?? ''}
        disabled={disabled === true}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        {noneLabel !== undefined && <option value="">{noneLabel}</option>}
        {value !== null && !options.some((o) => o.ref === value) && (
          <option value={value}>{value}</option>
        )}
        {options.map((o) => (
          <option key={o.ref} value={o.ref} title={o.description}>
            {o.name}
            {o.source === 'user' ? ' · yours' : ''}
            {!o.valid ? ' · unvalidated' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

const MODALITY: Record<string, string> = {
  sight: '👁',
  sound: '👂',
  touch: '✋',
  smell: '👃',
  intero: '🫀',
  narrative: '📜',
}

const ORIGIN: Record<string, string> = { scene: 'Scene', lab: 'Lab' }

/** What Maxim sensed, newest first, and whether it reached attention. */
export function SensationFeed({ sensations }: { sensations: SensationView[] }) {
  if (sensations.length === 0)
    return <p className="text-xs text-fg-muted">Nothing sensed yet this session.</p>
  return (
    <ol aria-label="Sensations" className="flex flex-col gap-1 text-xs">
      {[...sensations].reverse().map((s, i) => (
        <li key={`${s.at}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5">
          <span aria-label={s.modality} title={s.modality}>
            {MODALITY[s.modality] ?? s.modality}
          </span>
          {s.path !== null && <span className="text-fg-muted">{s.path.join(' › ')}</span>}
          {s.origin !== 'body' && (
            <span className="rounded-panel border border-accent px-1 text-accent">
              {ORIGIN[s.origin] ?? s.origin}
            </span>
          )}
          <span className="text-fg">{s.summary}</span>
          {s.intensity !== null && (
            <span className="text-fg-muted">{`${Math.round(s.intensity * 100)}%`}</span>
          )}
          {s.pain !== null && s.pain > 0 && (
            <span className="text-err">{`pain ${fmt(s.pain)}`}</span>
          )}
          {s.escalated !== null && (
            <span
              title={s.escalationReason ?? undefined}
              className={s.escalated ? 'text-ok' : 'text-fg-muted'}
            >
              {s.escalated ? 'reached attention' : 'filtered out'}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

export interface BodyPanelViewProps {
  /** null while the first snapshot loads. */
  body: BodyView | null
  sensations: SensationView[]
  bodies: ComponentOption[]
  /** The body the dropdown shows: the active one, or the one being previewed. */
  selected: string | null
  onSelect: (ref: string | null) => void
  /** The resolved spec of `selected` when it is NOT the active body (a preview). */
  preview?: PartView | null
}

export function BodyPanelView({
  body,
  sensations,
  bodies,
  selected,
  onSelect,
  preview = null,
}: BodyPanelViewProps) {
  if (body === null) return <p className="text-sm text-fg-muted">Loading the body…</p>
  const previewing = selected !== null && selected !== body.ref
  const shown = previewing ? preview : body.root
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <EmbodimentChip embodiment={body.embodiment} />
        <div className="min-w-0 flex-1">
          <ComponentPicker label="Body" options={bodies} value={selected} onChange={onSelect} />
        </div>
      </div>
      {previewing && (
        <p role="status" className="text-xs text-fg-muted">
          Previewing {selected}. Maxim’s body does not change until it is restarted with it.
        </p>
      )}
      {!previewing && body.embodiment === 'none' && (
        <p className="text-sm text-fg-muted">
          Maxim has no body in this session. Pick one above to see what it would sense and do.
        </p>
      )}
      {shown !== null && <PartNode part={shown} />}
      {previewing && shown === null && (
        <p className="text-xs text-fg-muted">Loading the preview…</p>
      )}
      {body.embodiment !== 'none' && (
        <section aria-label="What Maxim sensed" className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold text-fg">Sensed</h4>
          <SensationFeed sensations={sensations} />
        </section>
      )}
    </div>
  )
}
