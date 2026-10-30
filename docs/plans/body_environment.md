# Body & Environment: a console tab for SEM components and sensations

Status: **proposed** (owner idea 2026-10-26). Written after a five-part parallel review of pymaxim `main` (97f02e74)
and pulse `main` (9af8a57). The review covered:
- the SEM component model;
- environments and sensation;
- live edits in the run loop;
- security;
- pulse UX and contract fit.

Every claim was traced to code, and the load-bearing ones were re-checked by hand.

**Since (2026-10-30):**
- **Hazard 3.1** is pymaxim **#1496**. Until it ships, no Console path writes to `~/.maxim/components/`.
- **Phase 1 is agreed in pymaxim #1497.** The adjustments to the shapes below:
  - `/api/body` is fetched on open and after each `/ws` reconnect, then patched by `body_state` events; a
    `generation` mismatch means refetch, and nothing is polled;
  - `embodiment` is `none | simulated | hardware`, not a boolean;
  - every `path` is `str[]` segments;
  - `modality` is pymaxim's `SensoryModality`, rendered as given;
  - `available` is `bool | null`, from dispatch's own rule;
  - the gate field is the thalamic gate's `escalated: bool | null` plus `escalation_reason`.
- **Phase 1 lands after #1496 and contract 0.7.0, outside pymaxim 1.3.4.**
- **pulse #60 built the views props-only** (`packages/kit/src/components/body/`, plus seam-gated rail panels).
  The wiring waits for the generated types.

Owner's idea: *a tab like Thinking / bio-system, for SEM components and environmental sensations, where a user can
build and edit body components and environment sensors in real time and watch how Maxim responds.*

## 1. Verdict

**Useful, viable in phases, and almost entirely pymaxim work first.** Today there is nothing for pulse to bind to:

- **The console agent has no body.** `maxim serve` builds `MaximHandle(agent_id=…)` with no `body=`
  (pymaxim `console/server.py:1275`), and `build_app` has no body parameter (`server.py:2008-2017`).
  So no sensors, drives or failure modes exist in the process the console talks to.
- **No route touches SEM.** The seam table (`server.py:937-948`) and the 19 openapi paths have no body,
  component or environment surface.
- **Bodies are fixed at construction.** Tools (`sense_*`, `read_*_*`, `<ent>_<affordance>`) are generated once,
  holding direct object references (`embodiment/tool_bridge.py:1022-1105`). There is no reload, re-embody or
  swap path. The registry scans once, with no rescan (`component_registry.py:436-478`).
- **Injection exists but is Python-only.**
  - `ConversationalSource.inject_sensor` / `inject_pain` (`simulation/conversational_source.py:80,136`) sit on the
    live talk loop's bridge, and `inject_sensor` has no production caller.
  - `SetEntitySensorTool` (`simulation/tools.py:938`) is the resolve → clamp → re-evaluate path for a sensor write.
  - None of these is reachable over HTTP or `/ws`.

The *response* side already exists. BIO-tier `sim_log` records (SENSOR, BODY_STATE, PAIN, REACTION, DRIVE, GATE,
REFLEX, DELIBERATION…; `simulation/sim_logger.py:515-560`) already stream over `/ws`, and pulse's Activity and
Thinking panels already render them. Once a stimulus can get in, "watch how Maxim responds" is mostly built.

**Why it's worth doing:** it is the most direct way to show the bio-inspired thesis:
- a drive drifts and pain rises;
- the fear gate inhibits an action;
- an injured part degrades its affordances;
- the agent narrates the change.

It is also a debugging and teaching surface for SEM authors. Today they edit YAML and rerun a campaign from the CLI.

## 2. What SEM gives us (ground truth)

- **SEM = Sensor-Entity-Modulator** (`embodiment/sem.py:1-12`). An `Entity` tree carries:
  - `sensors` (unit, range, initial, optional homeostatic or entropic `drive`);
  - `modulators` (`affordances` with typed params, `self_effect`);
  - `failure_modes` (`trigger: {field, op, value, pain}`);
  - `vital_metrics` (the live values).
  - Example: `_data/components/bodies/reachy_mini.yaml` (12 sensors).
  - `reachy_mini_infant.yaml` `extends` it to add hunger and thirst. It keeps `entity.name` so learned keys match.
- **Environments are SEM entities too** (`entity_type: environment`; e.g. `forest_clearing.yaml`, and
  `haunted_manor.yaml` with `freezing: temperature < -5 → pain 0.4`). They are not world simulators. The DM narrates
  them to the agent through the bridge (`simulation/dm_runtime.py:388,498,618`), and campaigns pull them in as
  `world_objects`.
- **Loading.** `ComponentRegistry`: campaign dir → **`~/.maxim/components/`** (shadows bundled) → bundled
  `_data/components`. It uses `yaml.safe_load` throughout, has no class-path or eval hooks, and detects `extends`
  cycles. It has a session-scoped **ephemeral overlay** (`register_ephemeral` / `clear_ephemeral`, `:342-397`): the
  natural home for edited specs.
- **What's live per tick:**
  - sensor values (`vital_metrics`);
  - drive drift and failure evaluation (`runtime/loop_gates.py:255`);
  - the body state in the prompt;
  - degraded-affordance filtering.
  - What's frozen: the tool set, Cerebellum keys (`entity_path|modulator|affordance|bucket`) and NAc `tool:*`
    biases. **Renaming or restructuring a part orphans learned state silently.** There is no body fingerprint or
    migration (`cerebellum.py:446-506`).
- **The validator is scattered.** `_parse_entity` checks structure (`spec.py:408,892`). The best checks live in the
  sim layer: `simulation/entity_designer.py:388 validate_entity_spec` and `foundry.py:315 validate_candidate`.
- **There is no amygdala or neuromodulator module.** Sensation is `Percept` (`agents/bus.py:228`; SIGHT, SOUND,
  TOUCH, SMELL, INTEROCEPTION…) → `SimulationAdapter` → `ThalamicGate`. Pain goes PainBus → `PainCircuitBridge` →
  NAc, then `FearGatedExecutor`. The console agent runs `with_fear_gate=False` (`console/handle.py:175-186`).

## 3. Hazards the review found (must shape the design)

1. **Critical, and true today without any new UI: a YAML value drives the motors, and NaN passes every clamp.**
   - On the robot, the `orient` affordance's `self_effect.head_yaw` *is* the motor command
     (`hardware/reachy/motor_backend.py:9-10, 404-414`).
   - `float(".nan")` survives parsing, and `max(-L, min(L, x + nan))` returns `+L` with a 1 s duration
     (`motor_backend.py:275-279`). Re-checked by hand: `head_yaw: .nan` commands a full swing to +160° in 1 s.
   - The controller's `_clamp` tests `abs(v) > limit`, which is False for NaN (`controller.py:514-525`).
   - `MotionTarget.duration` reaches the SDK with no floor (`controller.py:715`).
   - The YAML exposes `goto_pose` / `recenter` `duration: float`. A near-zero duration is a snap, the 2026-08-07
     failure class that destroyed motors 2 and 3 (`controller.py:500-505`).
   - Reachable today by any YAML in `~/.maxim/components/`. **Reported to pymaxim regardless of this tab.**
2. **Memory poisoning.**
   - Every stop runs full consolidation into `~/.maxim/agents/<id>/` (`server.py:2113`). Synthetic stimuli would
     become episodes, NAc causal links and Cerebellum entries of the user's real agent.
   - No episode carries a synthetic or provenance flag.
   - `load_persisted=False` still writes. There is no `persist=False`.
   - In-process isolation is partial: `data_home()` consumers (orchestrator, components, provenance) are global.
3. **Injected sensations are user text.** `SimulationAdapter` turns a non-sound percept's `content` into
   `cli_input` (`runtime/sim_adapter.py:146-150`), so the LLM reads an injected "touch" as something the user typed.
4. **Component text is trusted LLM text.** An affordance `description` becomes a tool description verbatim
   (`tool_bridge.py:415-416`). Nonce framing (`utils/content_safety.py:334-363`) covers tool *results* only.
5. **One full-power token, plain HTTP on the robot's LAN.**
   - The robot console is `0.0.0.0:8765` over HTTP (pulse `apps/reachy/maxim_reachy_app/app.py:108,137`).
   - The token has no scopes. Today a stolen token can chat and reroute the LLM. With a body write it could
     move motors.
6. **No input envelope.**
   - The loader caps no size, count, depth or alias expansion.
   - Request models have no `extra="forbid"`.
   - `RunRequest.input` is capped only in sandbox mode (`server.py:1558`).
7. **The atonia gate and `embody()` are plans, not code** (`docs/plans/advisor_mode.md:3` "PLAN, no code"; no
   `def embody`/`def adopt`). The UI must not cite guarantees that don't exist yet.

## 4. Design

**Principle: the user explores a *sandbox Maxim*, never their own agent, and never a motor.** Live edits to the real
agent or robot are a separate, late phase gated on hardware fixes and a scoped capability.

### Phase 1: see the body (read-only)

- **pymaxim:**
  - an embodied console agent (a body choice for `maxim serve` / `build_app`, e.g. `console.body`, in the
    simulated stub mode);
  - `GET /api/body`: a typed projection of `Entity.to_dict()` (`sem.py:1008`) plus `body_state_summary()`
    (`body.py:687`) plus degraded affordances (`body.py:948`), labelled `simulated: true` when modulators are stubs
    (stubs report success they never performed, `bootstrap.py:461-466,517-520`);
  - `GET /api/components` (refs + resolved specs; never file paths);
  - typed `/ws` kinds `body_state`/`sensation` (R3 typed payloads, opt-in like `health`).
- **pulse:**
  - a `BodyPanel` in the kit (plain DOM: entity tree, sensor values against range/comfort band, drives, failure
    state, degraded affordances), seeded by `GET /api/body` and following `/ws`;
  - optional lazy `BodyGraph` (react-flow) in `@maxim/kit/viz`;
  - a kit change: `PanelSpec` gains `requires`/`missing`, and PanelRail wraps `render` in `<Gated>`;
  - **Console-only.** The Reachy profile stays consumer-first and its bundle stays lean (`size:reachy`);
  - one named accessor per record kind (`sensationLine`, `bodyLine`), tested against producer-shaped records.
- **Security:** GET only behind the existing bearer guard. Escape all author-controlled text. Acceptable on the
  robot's LAN at today's posture.
- **pulse effort:** ~3–4 days after the seam lands (+1–2 for the graph).

### Phase 2: the sandbox lab (poke and edit a throwaway Maxim)

- **pymaxim:**
  - **A sandbox agent** with its own handle and a temp home, with `persist=False` that truly writes nothing
    (cerebellum, hippocampus, NAc, `data_home` consumers). The simplest correct form is a separate process with
    temp `MAXIM_DATA_HOME`/`XDG_CONFIG_HOME`, the way `pnpm live` already does it. It never attaches a
    `modulator_factory`, controller or SDK handle. `build_app` refuses it on a device until phase 3.
  - **`POST /api/lab/stimulus`** → `inject_sensor` / `inject_pain` on the sandbox's bridge.
    - Typed `{modality, intensity, salience, text?}`, carried as a *percept*, not `cli_input`.
    - Text nonce-framed `source=external, untrusted`.
    - pymaxim decides whether a stimulus counts as a turn.
  - **`POST /api/lab/sensor`** (set/delta a sensor) → the `SetEntitySensorTool` resolve/clamp/re-evaluate path.
    This is the cheap live demo: values are observed every tick with no rebuild.
  - **`GET /api/lab/schema` + `POST /api/lab/validate` + `POST /api/lab/apply`** for structural edits:
    - **one canonical validator** (promote `validate_entity_spec` + a dry-run `_parse_entity`);
    - pydantic `extra="forbid"`, finite and bounded numbers, size/count/depth caps, no YAML aliases;
    - names `[a-z0-9_]{1,40}`, capped descriptions;
    - `extends` only to bundled refs;
    - specs held in the registry's **ephemeral overlay**, never written to the search path.
  - **Apply = restart the sandbox session with the edited spec,** not hot-patching. Tools and keys are generated at
    build time; copy the handle's `config_generation()` rebuild pattern (`console/handle.py:224,368,413`).
  - Seams `body_lab` (and `body`) declared with honest `detail` when not live.
- **pulse:**
  - a "Lab" drawer: a **schema-driven form** (sliders and fields from `GET /api/lab/schema`), not a YAML text editor.
    The UI must not parse or validate YAML, and `to_dict` drops affordance params, so a YAML round-trip loses data;
  - Validate → Apply, modelled on SetupWizard/ConnectionTest (probe-before-save);
  - a stimulus palette (touch / sound / temperature / pain at an intensity, on a part);
  - an event timeline of the response from existing BIO events;
  - errors: 409/422 show the server's reason, 501 shows "unavailable", and `AuthError` renders nothing (the Logs
    pattern, not SetupWizard's);
  - a banner: "Sandbox Maxim. Nothing here is remembered."
- **Security:**
  - everything in phase 1;
  - sandbox only;
  - on a device, refused unless the request comes from localhost (or the phase 3 capability).
- **pulse effort:** ~5–7 days.

### Phase 3: live (the real agent, the real robot): deferred

- **Preconditions in pymaxim:**
  - hazard 3.1 fixed: `isfinite` before every clamp, a duration floor and ceiling, a per-affordance delta and rate cap
    independent of the spec, and the second `ReachyMini()` connection removed (`audio_localization.py:227`);
  - `embody()` and the embodied actuation census landed (#1440 step 4);
  - motor-binding fields (`self_effect` on `orient`, `goto_pose` durations) **not editable from the console** at all.
- **Before any of it reaches the real agent:**
  - memory provenance: synthetic inputs stamped `console-synthetic` and excluded from consolidation, or
    consolidation suspended;
  - a body fingerprint beside `cerebellum.json` / `nac.json`, so a changed body is flagged, not silently orphaned.
- **Security:**
  - a **scoped, short-lived write capability**, separate from the chat token and granted by a local or physical act
    (e.g. an antenna press);
  - TLS or an equivalent before motor-affecting writes travel the LAN;
  - an audit log;
  - a diff + confirm in the UI;
  - one-click revert to the bundled body.
- Not scheduled. Revisit after the device plan (#1440) lands.

### Owner decisions (2026-10-26)

- **The body is a dropdown.**
  - The list comes from the registry's `bodies/*` refs (`ComponentRegistry.list_refs`). This includes user bodies
    in `~/.maxim/components/bodies/`, shown with an "unvalidated" badge until `validate` passes.
  - In phase 1, selecting a body **previews** its resolved spec. It does not re-embody the user's agent.
  - In the lab, selecting a body and pressing Apply restarts the sandbox with that body.
  - Selecting is the first step in editing: choose a body, then adjust it in the form.
- **The lab stays on the desktop Console.** It never appears on the robot page.
- **Bodies and stimuli come first. Scenes follow as a second dropdown** (`environments/*` refs, plus "none"). They use
  the same Apply = restart flow.
  - A scene is more than a stimulus bundle. It adds three things:
    - **ambient sensors** (`visibility`, `ambient_noise`, `temperature`…), adjustable like body sensors;
    - **affordances** that become tools the agent can use (`survey`, `hide`, `forage`);
    - **failure modes** that link the scene to pain (`haunted_manor`: `temperature < -5 → pain 0.4`).
  - **pymaxim must perceive the scene without a DM.** In campaigns the DM narrates the scene
    (`dm_runtime.py:388,498,618`). The sandbox needs a scene percept source: one percept on entry, and one whenever a
    scene sensor changes, carried as a percept rather than `cli_input`.
  - Phase-2b pymaxim ask: `scene=` on the sandbox, that percept source, and scene sensors on `POST /api/lab/sensor`.

## 5. Contract

- New seams arrive in **one minor contract bump**: `body` (phase 1) and `body_lab` (phase 2). They ride R3's 0.7.0
  if it is still open, else 0.8.0.
- All body and sensation records are **typed schemas**, not free `data` dicts, so the openapi diff sees renames.
- Older servers: the panel shows the seam's `missing` text, never a blank panel.
- Release order as always: pulse tags → pymaxim vendors → pymaxim releases → `check_pymaxim_vendor.py`.

## 6. Ask to pymaxim (in priority order)

1. **Now, independent of this tab:** fix hazard 3.1 (NaN/inf pass the motor clamp; no duration floor). Add a regression
   test with `head_yaw: .nan` / `duration: 0` in a user component.
2. A body for the console agent + `GET /api/body` + typed `body_state`/`sensation` events (phase 1).
3. A sandbox lab: `persist=False` (or a separate process), stimulus and sensor seams over the existing
   `inject_sensor`/`inject_pain`/`SetEntitySensorTool` paths, percept-not-`cli_input` delivery, one canonical
   validator, the ephemeral overlay, and apply = restart (phase 2).
4. Scenes (phase 2b): `scene=` on the sandbox, a DM-less scene percept source (on entry and on each scene-sensor change),
   scene sensors on the sensor seam.
5. Later: provenance stamps, a body fingerprint, a scoped write capability (phase 3).

## 7. Open questions for the owner

- The default selection in the body dropdown for a plain `maxim serve` (proposed: `infant_humanoid`, which has the
  richest drives).
