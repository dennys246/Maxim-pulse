/**
 * The Body & Environment panel's VIEW model (docs/plans/body_environment.md, Maxim #1497).
 *
 * UI-owned: the shapes the body views render, not pymaxim's wire types. The wire
 * records (`GET /api/body`, `/ws` `body_state` and `sensation`) arrive through the
 * generated schema once the seam ships, and one accessor per record kind maps each
 * onto these — so a field rename on the wire touches an accessor, never a view.
 *
 * Absence is explicit: `null` means "the server did not say", and the views render
 * nothing for it rather than a guess (an ability with `available: null` gets no
 * indicator; a sensation with `escalated: null` makes no claim about attention).
 */

/** Whether this session's Maxim has a body, and whether its actions are real. */
export type Embodiment = 'none' | 'simulated' | 'hardware'

export interface DriveView {
  mode: 'homeostatic' | 'entropic'
  setPoint: number | null
  comfortBand: [number, number] | null
  pressure: number | null
}

export interface SensorView {
  name: string
  unit: string
  range: [number, number]
  /** null = unreadable right now. */
  value: number | null
  drive: DriveView | null
}

export interface AbilityView {
  name: string
  /** From the dispatcher's own rule, or null when the server cannot say. */
  available: boolean | null
  reason: string | null
}

export interface ModulatorView {
  name: string
  /** 0..1; null when unreported. */
  integrity: number | null
  abilities: AbilityView[]
}

export interface FailureView {
  name: string
  pain: number | null
}

export interface PartView {
  /** Entity path as segments (names may contain dots; never split a joined string). */
  path: string[]
  name: string
  kind: string
  sensors: SensorView[]
  modulators: ModulatorView[]
  failures: FailureView[]
  children: PartView[]
}

export interface BodyView {
  embodiment: Embodiment
  /** Component ref, e.g. "bodies/infant_humanoid"; null when there is no body. */
  ref: string | null
  /** Bumps on every rebuild; a change for another generation means refetch. */
  generation: number
  root: PartView | null
}

/** One live update to the body: only what changed. */
export interface BodyChange {
  generation: number
  readings: { path: string[]; sensor: string; value: number | null }[]
  failuresEntered: { path: string[]; name: string; pain: number | null }[]
  failuresCleared: { path: string[]; name: string }[]
  availability: {
    path: string[]
    modulator: string
    ability: string
    available: boolean | null
    reason: string | null
  }[]
}

export interface SensationView {
  at: string
  /** "body" | "scene" | "lab" today; rendered as given if the server adds more. */
  origin: string
  /** pymaxim's SensoryModality value, rendered as given if unknown. */
  modality: string
  path: string[] | null
  intensity: number | null
  salience: number | null
  pain: number | null
  /** Did it reach attention (the thalamic gate)? null = it did not pass through the gate. */
  escalated: boolean | null
  escalationReason: string | null
  /** Display-only, untrusted text. */
  summary: string
}

/** One entry in the body (or scene) dropdown. */
export interface ComponentOption {
  ref: string
  name: string
  description: string
  source: 'bundled' | 'user'
  /** Passed the server's validator. */
  valid: boolean
}

const samePath = (a: string[], b: string[]) =>
  a.length === b.length && a.every((segment, i) => segment === b[i])

/** The part at `path`, or null. */
export function findPart(root: PartView | null, path: string[]): PartView | null {
  if (root === null) return null
  if (samePath(root.path, path)) return root
  for (const child of root.children) {
    const hit = findPart(child, path)
    if (hit !== null) return hit
  }
  return null
}

function mapPart(root: PartView, path: string[], update: (part: PartView) => PartView): PartView {
  if (samePath(root.path, path)) return update(root)
  return { ...root, children: root.children.map((child) => mapPart(child, path, update)) }
}

/**
 * Apply a live change to the last snapshot. Returns null when the snapshot can no
 * longer be patched — another generation, or a path the snapshot does not know —
 * and the caller must refetch. Never patches a guess into the tree.
 */
export function applyBodyChange(body: BodyView, change: BodyChange): BodyView | null {
  if (change.generation !== body.generation || body.root === null) return null
  const paths = [
    ...change.readings.map((r) => r.path),
    ...change.failuresEntered.map((f) => f.path),
    ...change.failuresCleared.map((f) => f.path),
    ...change.availability.map((a) => a.path),
  ]
  if (paths.some((path) => findPart(body.root, path) === null)) return null

  let root = body.root
  for (const reading of change.readings) {
    root = mapPart(root, reading.path, (part) => ({
      ...part,
      sensors: part.sensors.map((s) =>
        s.name === reading.sensor ? { ...s, value: reading.value } : s,
      ),
    }))
  }
  for (const cleared of change.failuresCleared) {
    root = mapPart(root, cleared.path, (part) => ({
      ...part,
      failures: part.failures.filter((f) => f.name !== cleared.name),
    }))
  }
  for (const entered of change.failuresEntered) {
    root = mapPart(root, entered.path, (part) => ({
      ...part,
      failures: [
        ...part.failures.filter((f) => f.name !== entered.name),
        { name: entered.name, pain: entered.pain },
      ],
    }))
  }
  for (const a of change.availability) {
    root = mapPart(root, a.path, (part) => ({
      ...part,
      modulators: part.modulators.map((m) =>
        m.name !== a.modulator
          ? m
          : {
              ...m,
              abilities: m.abilities.map((ab) =>
                ab.name === a.ability ? { ...ab, available: a.available, reason: a.reason } : ab,
              ),
            },
      ),
    }))
  }
  return { ...body, root }
}

/** Where a value sits in its range, 0..1, or null when it cannot be placed. */
export function rangeFraction(value: number | null, range: [number, number]): number | null {
  const [low, high] = range
  if (value === null || !Number.isFinite(value) || !(high > low)) return null
  return Math.min(1, Math.max(0, (value - low) / (high - low)))
}

/** Whether a driven sensor sits inside its comfort band; null when it cannot say. */
export function comfort(sensor: SensorView): 'inside' | 'outside' | null {
  const band = sensor.drive?.comfortBand ?? null
  if (band === null || sensor.value === null || !Number.isFinite(sensor.value)) return null
  return sensor.value >= band[0] && sensor.value <= band[1] ? 'inside' : 'outside'
}
