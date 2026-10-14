# Log explorer — the Console as the place to see what an agent did and why

**Status:** BUILDING. Owner decisions 2026-10-13 (§6). §7 (one console, many devices) built on pulse
branch `console-profiles`. The backend endpoints PR is built on pymaxim `feat/console-run-store` and has
been through a three-lens review; its outcomes changed this design and are recorded in §8.
**Repos:** maxim-pulse (UI, this file) + pymaxim (backend, §4 mirrors into
`docs/plans/console_log_explorer.md` there).
**Contract:** 0.5.0 → **0.6.0** (additive; §5).
**Basis:** pymaxim `origin/main` @ `d9822dd4` (1.3.1 + 642). Every claim below was
checked against code; file:line refs are origin/main.

## 1. What exists today (Step 0)

The Console reaches **none of the history**. Live, it reaches only what `sim_log`
emits onto `/ws`.

| Source | Written by | Lands | Console today |
|---|---|---|---|
| Health snapshot `event:"heartbeat"` | `runtime/heartbeat.py` `_emit` :193, every 10 s | std logger at **DEBUG** — on disk only if `MAXIM_LOG_FILE` is set | No. Monitor is **off by default** under `maxim serve` (needs `MAXIM_HEARTBEAT`/`MAXIM_LANE_TRACE` or leader auto-spawn) |
| Stall `event:"heartbeat_stall"` | `_check_stall` :219 | same logger, WARNING | No — and **it can never fire**: it needs `loop.idle_s`, set only via `set_loop_state_hook`, which nothing in `src/` calls |
| `swallowed_exception` | `utils/logging.py::log_swallowed_exception` :406 | std logger; WARNING first fire per site, DEBUG after | No. Not sim_log, so not on `/ws`. 10 explicit `site=` + ~85 frame-derived sites; ~45 legacy calls emit **no event at all** |
| NAc credit `sim_nac` / `sim_nac_learn` | `sim_logger.py` :1225 / :1379 | `/ws` kind `nac`, tier bio; per run in `bio_telemetry.jsonl` | **Live only.** `sim_nac` has `data={}`; `sim_nac_learn` has `{event,outcome,confidence,rpe,link_type}`. In JSONL both are `e:"sim_nac"` — key on `link_type`, not `e` |
| Per-invocation `ToolOutput.rpe/pain/nac_failure_booked` | stamped by `executor.py` :916 | **nowhere on disk** — `actions.jsonl` does not carry them | No |
| Run artefacts `sim_reports/{id}/` | orchestrator end-of-run :3433 | `report.json`, `actions.jsonl`, `bio_telemetry.jsonl`, `aut_*.json` | No route |
| Process JSONL `MAXIM_LOG_FILE` | `configure_logging` :22, rotating | env-only, off by default | No |
| `lane_decisions.jsonl` | `runtime/decision_log.py` (lane routing — **not** provenance) | `~/.maxim/util/`, capped 1000 records | No |
| Provenance `{session}.jsonl` | `provenance/store.py` | `~/.maxim/provenance/` | No (empty on this box) |
| `MAXIM_BACKEND_TRACE=1` | `maxim_peer_backend.py` :280 | **no file** — raises one event DEBUG→INFO | — |

On this machine: 998 run dirs, **895 MB**; 731 with `report.json` (4.2 MB of reports,
13 MB of actions); 267 aborted dirs holding only `generated_campaign.yaml`; `aut_*.json`
are the bulk (hippocampus alone 319 MB).

Facts the design must respect:

- **Talk and rest write no run artefacts.** Only adventures (and CLI sims) do. A
  console run's `run_id` ≠ the sim `session_id`; they are linked only by the `/ws`
  `run` ended/failed event (`sim_session_id`, `report_path`, server.py :1172).
- **No local `report.json` has a start time.** `ts` is newer than all 731; `timestamp`
  is end time. Start = `ts` if present, else parsed from a `%Y%m%d_%H%M%S` id, else
  the `actions.jsonl` header/first line, else null.
- **`resolve_run_dir` is unsafe for request data**: a path-like argument returns any
  directory on disk, it searches the CWD first, and it follows symlinks out of
  `sim_reports`. The console must not call it with a request value.
- **There is no paged/filtered JSONL reader in `src/`.** The leader proxy's
  `_LogBuffer.get_since(since_seq, limit)` is the cursor pattern to copy.

## 2. Gaps the Definition of Done exposes

Each needs a pymaxim fix **before** the console can show it, and each lands
test-first as an `xfail(strict=True)` red gate.

1. **"See that a stall happened."** Wire `set_loop_state_hook` from the agent loop
   (pymaxim). Without it `heartbeat_stall` cannot fire anywhere.
2. **"See which failures the bridge credited, and with what surprise."** Persist
   `rpe`, `pain`, `nac_failure_booked` per action in `actions.jsonl`
   (`_format_version` 1.1 → 1.2). Past runs cannot be backfilled; the UI says so.
3. **"Filter that run's JSONL by event or site."** A run has no complete event file:
   `bio_telemetry.jsonl` is bio-only, the full sim_log trail goes to
   `sim_sandbox/sim_agent_<stamp>.jsonl` (no link to the session id), and
   `swallowed_exception` never reaches either. Write the run's trail **into the run
   dir** as `events.jsonl`, including event-tagged std-logger records
   (`swallowed_exception`, `heartbeat*`) emitted while that run was active.
4. **Health outside a run.** The console process holds a bounded health log (§4.3).

## 3. UI (pulse)

A **Logs** surface, opened from the top bar, full-width (not a rail panel — a run
timeline needs the width). Built **once** in the kit and listed by both device
profiles (§7); the Reachy profile takes the lean variant.

- **Run list** — paged, newest first: start, mode, goal, outcome (`finish_reason`),
  turns, duration, cost; aborted runs collapsed behind a toggle.
- **Run view** — report header, then the **action timeline** in order. Each action
  row: tool, params (collapsed), success / blocked, and a **credit chip**:
  `booked by bridge` · `rpe ±x.xx` · `pain x.xx`. Pre-1.2 actions show "credit not
  recorded for runs before pymaxim X" — never a blank chip.
- **Event table** — the run's `events.jsonl`, paged, filtered by event, subsystem,
  site, level and time. NAc credit lines key on `link_type` (since #1257 a
  bridge-booked failure is traced once, by `sim_nac_learn`).
- **Health strip** — the latest snapshot (GPU/VRAM/temp, CPU/RAM, large-lane p50,
  calls, idle) as one line under the top bar, with a red mark per stall; click opens
  the history.
- **Degraded** — `swallowed_exception` grouped by `site`: count, first/last seen,
  `exc_type`, one sample message. The "something degraded silently" view.
- **Weight.** Tables and the strip are plain DOM in the lean kit. Anything chart-like
  (latency/VRAM sparklines, the timeline as a graph) lives in `@maxim/kit/viz`,
  lazy-loaded; `pnpm size:reachy` keeps it out of the robot bundle.
- **Offline tests.** MockFacade gains fixture runs (a normal adventure, an aborted
  dir, a pre-1.2 actions file, a run with a booked failure and a stall).

## 4. Backend (pymaxim) — mirror of the pymaxim plan

All routes **GET, read-only, behind the existing bearer auth**, and **refused under
sandbox mode** (a public visitor must never read run history). No route takes a path.

### 4.1 Routes

| Route | Returns |
|---|---|
| `GET /api/runs?cursor&limit` | `RunPage{runs: RunSummary[], next_cursor}` — session_id, started_at (derived), mode, goal (≤200 chars), finish_reason, turns, duration_s, cost_usd, total_actions, has_report |
| `GET /api/runs/{session_id}` | `RunReport` — a named subset of `SimulationReport`; never `aut_*` |
| `GET /api/runs/{session_id}/actions?cursor&limit` | `ActionPage` — header skipped; `available`/`reason`; credit keyed off the header version (≥ 1.2) |
| ~~`GET /api/runs/{id}/events`~~ | **Deferred** (§8): ships with the writer that defines the trail's record shape |
| `GET /api/health?since` | `HealthResponse{monitoring, stall_detection, recorded_since, latest, stalls, series}` — unpaged; the series is downsampled to ≤ 2000 points |
| `GET /api/health/degraded?since` | `DegradedResponse{since, counted_since, sites: DegradedSite[]}` |

### 4.2 The run-id resolver (the security boundary)

A new `console/run_store.py::resolve_console_run(id) -> Path`, **not**
`resolve_run_dir`:

1. `id` must match `^[A-Za-z0-9_-]{1,64}$` (covers `%Y%m%d_%H%M%S`, `research_*`,
   `bisect-*`). Anything else → 404, the same as a missing run.
2. `root = sim_reports().resolve()`; `p = (root / id).resolve()`; require
   `p.parent == root` and `p.is_dir()`. Symlinked run dirs that resolve elsewhere → 404.
3. Files are opened **by fixed name only** (`report.json`, `actions.jsonl`,
   `events.jsonl`), each re-checked `resolve().parent == p` and `is_file()`, opened
   with `O_NOFOLLOW` where the OS has it.

### 4.3 Health log

The console process starts a `HeartbeatMonitor` (decision §6 Q2) and attaches one
logging handler that keeps `heartbeat`, `heartbeat_stall` and `swallowed_exception`
records in a bounded ring, mirrored to `data_home()/console/health.jsonl` (rotating;
cap per §6 Q3). Scope is **this process** — peers and the leader proxy keep their
own (`/v1/debug/heartbeat`).

**Live:** `/ws` kinds **`health`** and **`health_stall`**, OPT-IN: never sent unless the
client names them in its subscribe frame's `kinds`, and naming them adds them to
whatever else the client receives (`{kinds: ["health"]}` is everything plus health;
the Reachy profile's `{tier: "clean", kinds: ["health"]}` is the clean tier plus
health). Never reuse `heartbeat`, which stays the empty 15 s keep-alive. Pulse
must keep health events out of TurnStatus's "is the turn moving" test and out of
the 2000-event ring: they carry `run_id: null`.

**Privacy:** `system_metrics` includes `network` and `wifi`. Health on the wire
and on disk carries an **allow-list** (gpu, cpu, memory, disk, lanes, loop) — never
SSIDs, interface addresses or hostnames.

### 4.4 Adversarial pass — every input, and how it could lie

| Input | How it lies | Defence |
|---|---|---|
| `{id}` path segment | `..`, `%2e%2e`, absolute path, `~`, NUL, unicode look-alikes, 10 KB string | Regex on the **decoded** value before any filesystem call; length cap; 404 for every failure (no oracle) |
| Symlink **dir** in `sim_reports` | Points at `/` or `~/.ssh` | `resolve()` then `parent == root` |
| Symlink **file** in a run dir | `report.json` → `~/.config/maxim/console_token` | Per-file resolve check + `O_NOFOLLOW`; JSON-parse failure → 422 without echoing bytes |
| `cursor` | Negative, past EOF, mid-line, from another file, huge | Opaque `{file, byte_offset, size_at_issue}` signed with an HMAC keyed per process. Server validates offset ≤ current size and that the preceding byte is `\n`. Unsigned or foreign → 400 |
| `limit` | 0, 10⁹, float, string | Integer, clamp 1–500 |
| Filter strings | Regex bombs, huge values | **Exact** match only (no regex, no substring); each ≤ 128 chars; level from an enum |
| `since`/`until` | NaN, ±inf, 1e308, strings | Finite floats, `since ≤ until`, else 400 |
| Line contents | A 2 GB single line; malformed JSON; non-UTF-8 | Max line 1 MB (skip, count); malformed lines skipped and counted in the page (`skipped: n`) |
| A file still being written | Run in progress, rotation mid-read | Read to the size captured at open; tolerate a partial last line |
| `MAXIM_DATA_HOME` | Operator-controlled | Trusted — it is the operator's own config, not request data |
| Non-dir entries in `sim_reports` (`campaign_analysis_*.json`) | Treated as runs | `is_dir()` filter in the listing |
| Two sims in one second | Same dir, interleaved | Listing reports what is on disk; the UI does not dedupe by id |
| Request volume | 1,000 `report.json` reads per list call | A summary index keyed by `(dir mtime, report mtime)`, rebuilt lazily; pages never read `aut_*` |
| Sandbox mode | A public visitor reads another session's history | Routes refused (403) under `console.sandbox` |
| Content | Reports carry params, tool output and response text | Bearer-only (operator). PR 4's viewer/operator split will need to classify these routes; flagged there |
| Health payload | Network/wifi identity leaking | Allow-list (§4.3) |

### 4.5 Order (each step its own PR, three-lens review)

1. Red gates first: `xfail(strict=True)` for the resolver refusals above, the stall
   hook, credit persistence and the trail file.
2. `run_store.py` + run routes + contract 0.6.0 + `[Unreleased]`.
3. Stall hook, `actions.jsonl` 1.2, `events.jsonl`.
4. Health handler, ring, `/ws` `health` kind.

## 5. Contract and handshake

0.6.0, additive: five routes, their page/record schemas, the opt-in
`health`/`health_stall` kinds, and three seams in `/api/identity`: `runs` (POSIX
hosts), `health` (live only while the server samples) and `degraded` (live while
it serves). The Reachy bootstrap must pass `build_app(health_monitor=True)` for
the robot's health strip to have data.

- **Old backend, new UI.** Each Logs feature gates on its seam being **present and
  live**. Note the kit's `isSeamLive` treats an unknown seam as live, which is right
  for old features and **wrong** here; the Logs surface uses a stricter
  `hasSeam`. Missing → "Run history needs a backend speaking console contract 0.6.0
  (pymaxim newer than 1.3.1)" — never a blank panel. A 404 from any Logs route is
  rendered the same way, as a belt-and-braces fallback.
- **New backend, old UI.** The existing skew banner fires, as it did for 0.5.0.

## 6. Owner decisions (2026-10-13)

1. **Scope v1:** run artefacts (report + ordered actions with per-action credit),
   the per-run event trail, and health + degraded sites. Lane decisions: later.
2. **Live health: yes, always.** `maxim serve` starts the HeartbeatMonitor and
   streams `health` / `health_stall`. The `heartbeat` keep-alive is untouched.
3. **History:** every run on disk, paged, nothing ever pruned (read-only). Health
   log capped at **7 days or 50 MB**, whichever comes first.
4. **Reachy: both.** The Reachy console is an *extension of* the pulse console, not
   a sibling. A fix needed in both must land once — §7 makes that structural, and
   is built **before** the Logs surface so Logs is written a single time.

## 7. One console, many devices — the extension model

**Today.** Both shells are ~80% the same composition: the same auth bootstrap in
`main.tsx`, the same provider stack (AuthGate → Identity → EventClient → Panels),
the same top-bar chips and chat core. They differ only in panel set, stream filter,
some top-bar buttons and drawer contents. That is why auth and pairing each had to
be wired twice, and why a third device would copy a third shell.

**Proposal.** The kit owns the shell; a device is a **profile**.

```ts
// apps/reachy/ui/src/main.tsx — the whole device shell
bootConsole(reachyProfile)

// packages/kit — a profile is data, not a component tree
const reachyProfile: DeviceProfile = {
  id: 'reachy',
  subscribe: { tier: 'clean' },          // the Pi's stream budget
  rails: ['right'],
  panels: ['memory'],
  surfaces: [chat, memory, setup, logsLean, healthStrip],
  links: [{ label: 'Guides', href: 'https://docs.pymaxim.bio/' }],
}
```

- **A surface is the unit of a feature.** It declares an id, where it mounts
  (top bar, drawer, rail, full page), the backend **seams it requires**, and a
  `load: () => import(...)` thunk. Logs, setup, models and the health strip are
  surfaces. A new feature is written once, as a surface, and opted into by profile.
- **What renders = profile ∩ backend seams.** The seam check that shows "needs a
  backend speaking contract 0.6.0" is the same mechanism that hides a surface on a
  device whose backend lacks it. One rule serves version skew *and* device
  capability.
- **The bundle boundary stays mechanical.** A profile references surfaces by lazy
  loader, so a device bundle contains only what its profile lists. Heavy surfaces
  live behind `@maxim/kit/viz`; `logsLean` is plain DOM; `size:reachy` keeps
  guarding the robot. A future device adds a profile and its own size budget.
- **Shell-level fixes land once.** Auth, pairing, the skew banner, the stream
  filter plumbing and the top bar move into `bootConsole`. The per-device app
  shrinks to the profile plus its build config.
- **Tests:** one shell test suite parameterised over every profile, plus a profile
  contract test (every surface's required seams exist in the contract; no lean
  profile references a viz loader).

**The Python side has the same shape.** The Reachy bootstrap re-composes what a
device console needs — handoff, trusted origins, the pairing announcer, a uvicorn
thread. A second robot would copy it. That composition is library logic and
belongs in pymaxim as one facade (e.g. `console.device.build_device_app(ui_dist, *,
port, advertised_hosts, speak)`), leaving each bootstrap as SDK glue. Not v1 —
raised as a pymaxim follow-up.

**Order.** §7 lands in pulse first (behaviour-preserving: both shells' existing
tests must pass unchanged), then the Logs surfaces on top of it.

## 8. What the review changed (2026-10-13)

pymaxim's three-lens review (Executor, Architecture, Wire integrity) of the endpoints PR, plus notes from
pymaxim Session C, changed these decisions. Each is folded on `feat/console-run-store`.

- **The resolver is NOT `utils/paths.py::resolve_run_dir`.** Session C's note asked for every read to go
  through it; the inventory and all three lenses show why it cannot: a path-like argument returns any
  directory, it searches the CWD first, and it follows symlinks out of `sim_reports`. Run ids go through
  `console/run_store.py`, whose opens are **anchored to directory file descriptors** (root, then the run dir
  with `O_DIRECTORY|O_NOFOLLOW`, then members). Path-based checks lost a swap race 25 times in 8 seconds
  under the Executor's probe. Members must be single-linked regular files (a hardlink to a secret passes
  `lstat` and `O_NOFOLLOW`) and are opened non-blocking (a FIFO hung a worker). Hosts without anchored opens
  (Windows) report the `runs` seam closed rather than serve a weaker boundary. `resolve_run_dir`'s
  docstring now says "not for request data".
- **`/events` is deferred.** No writer produces `events.jsonl`, and the obvious one (sim_log records) uses
  sim-elapsed `t` and nested `data`, which the reader I had guessed could not have handled. The route ships
  with its writer, which defines the record shape. NAc credit lines in that trail key on `sim_nac_learn`
  (pymaxim #1257: a bridge-booked failure is traced once, there).
- **Three producers are dormant, and the API says so.** Stalls (nothing calls
  `HeartbeatMonitor.set_loop_state_hook`, so `heartbeat_stall` cannot fire), per-action credit
  (`actions.jsonl` is 1.1), and the per-run trail. Each has a strict red gate. `/api/health` carries
  `stall_detection`; every current action reads `credit_recorded: false`. The UI must render both as
  "not recorded", never as "none".
- **Health on `/ws` is opt-in**, delivered only to a client that asks for it. As a broadcast it would have
  broken pulse's TurnStatus (any non-keep-alive event reads as "the turn is moving", so a hung run would
  look alive) and crowded the 2000-event ring. It carries no `run_id`.
- **Sandbox is gated at the producer.** No monitor and no publishing under sandbox: a REST 403 is no refusal
  if the same data rides `/ws`.
- **Route parameter is `session_id`** (the sim session id). The console's own run id has the same format;
  the join is the `/ws` `run` event's `sim_session_id`.

### Answers to Session C's questions

- **(a) Does v1 show per-action credit?** Yes. Its persistence (actions.jsonl 1.2) is a prerequisite pymaxim
  PR; the strict gate `test_gate_actions_jsonl_records_per_action_credit` flips when it lands.
- **(b) Does health cover console-hosted solo runs?** Yes. `maxim serve` starts the monitor. But stalls stay
  undetectable until the agent loop registers the loop-state hook (Session C's note says the stall fires
  after 30 s with no completed LLM call; it also needs `loop.idle_s`, which nothing provides).
- **(c) Do swallowed-exception and heartbeat records belong in the run directory?** Yes, for records emitted
  during a run: that is the per-run `events.jsonl` trail. The console's own health log covers the process
  between runs.

**Division of work.** The endpoints PR is built and reviewed here. The three producer PRs (stall hook,
actions 1.2, events trail) are the natural pymaxim Session C lane; each has its red gate waiting.
