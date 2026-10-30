# CLAUDE.md — maxim-pulse

Operational guide for Claude Code in this repo. **Architecture, execution flow, and
development standards live in [AGENTS.md](AGENTS.md) — read it first.** This file is the
checks + commands + Claude-specific workflow layer.

## Project overview

`maxim-pulse` — the **Maxim UI monorepo**: a React + TypeScript (Vite) monorepo producing a
shared UI kit + **two build targets** (the **Maxim Console** localhost dashboard, and the
**Reachy app** on-device HF Space). Both are **presentation over pymaxim** (`api.py` /
`maxim serve`). **Cardinal rule: presentation-only — fix hard things in pymaxim, not here.**
See AGENTS.md § "The cardinal rule" + "The three-layer architecture."

## Required checks (run before considering a task done)

```bash
# Lint + format + types (JS/TS)
pnpm lint          # eslint
pnpm format        # prettier
pnpm typecheck     # tsc --noEmit

# Tests — fully offline (facade client + maxim serve + Reachy SDK all mocked)
pnpm test          # vitest

# Build both targets (each stamps its dist/maxim-ui.json); confirm the Reachy bundle stays lean
pnpm build
pnpm size:reachy   # assert heavy viz (react-flow/visx) is NOT in the on-device bundle

# If the Reachy Python bootstrap changed (apps/reachy):
ruff check apps/reachy && ruff format apps/reachy && python -m pytest apps/reachy -q

# If the robot extra's pymaxim pin moved, or the bootstrap changed: the REAL bootstrap against
# the PUBLISHED pymaxim, only the robot faked (temp venv + temp HOME). CI runs it on Linux arm64
# for every PR that moves the pin (.github/workflows/release-smoke.yml) — a pin bump does not
# merge on a red smoke; for a bootstrap-only change, run it locally or dispatch the workflow.
scripts/smoke-reachy-release.sh [<pymaxim version>]

# If a UI flow, the contract mirror, or the shell changed: the BUILT bundles in real Chrome
# against a published pymaxim (sign-in, pairing, both profiles, Logs) — temp venv + HOME, run
# history seeded by pymaxim's own writers. CI runs it on every openapi.json re-sync (e2e.yml).
pnpm e2e [<pymaxim version>]

# Before tagging a pulse release against a pymaxim release (or on its candidate wheel): every
# automated check against what users install — vendored bundle, oldest/newest Python, upgrade,
# the real robot install. Then Tiers B (live agent) and C (robot): docs/release-checklist.md.
scripts/release-acceptance.sh <pymaxim version | wheel>

# See it live (reviewing a PR, or before a release): both consoles signed in over a real pymaxim,
# in a throwaway worktree + venv + HOME; prints the robot's spoken code; q deletes everything.
pnpm live --pymaxim <version | wheel> [--with <PR#>]... [--agent]
```

**Fakes prove wiring; only real releases prove compatibility.** Every unit test fakes pymaxim with
the API we _believe_ it has — those fakes all passed while pymaxim 1.3.2 could not speak a pairing
code. A claim about how pulse behaves on a pymaxim release ("the robot speaks", "health is
sampled") is verified by the release smoke, or by a run against that release, never by the fakes.
`PYMAXIM_SPEC=<wheel> scripts/smoke-reachy-release.sh` (or `scripts/e2e.sh`) tests a pymaxim
candidate before it ships. Never patch around a defect these find (installing a missing dependency,
skipping a check): the failure IS the finding — report it to pymaxim.

**Untyped `data` dicts are a contract the openapi diff cannot see.** Health samples, stall
records and degraded sites arrive as free-form `data`; a field rename there changes nothing in
`gen:facade:check`. Read them only through one named accessor per record kind
(`summarize`, `stallLine` in `components/logs/HealthViews.tsx`), each tested against a record in the
producer's real shape, and when pymaxim's openapi diff touches the description of such a record,
read the producer's code before re-syncing (#1279 renamed `idle_s` behind a description-only diff).

No test may spin up a real robot, a real LLM, or a live `maxim serve` — mock the facade client.
For Reachy loop tests use a fake SDK (the real `ReachyMini()` blocks without hardware).

## Running

```bash
# Console dev (needs pymaxim's backend for live data):
maxim serve                 # pymaxim, binds 127.0.0.1 — the Console's backend
pnpm --filter @maxim/console dev   # Vite dev server → talks to maxim serve (or a mock facade)

# Reachy target (offline dev): build + run the ReachyMiniApp bootstrap against a fake SDK.
pnpm --filter @maxim/reachy-ui build
```

- **Verify the token flow (contract 0.4.0).** `maxim serve` prints `http://127.0.0.1:<port>/#token=<t>`;
  a cold load with no token must show the paste screen (naming `maxim serve --show-token`) and
  touch only `/api/hello`; opening the printed URL signs the browser in (fragment stripped, token
  in localStorage, `Authorization: Bearer` on every call, `/ws` offered with
  `["maxim-console-v1", "maxim.bearer.<t>"]`); `maxim serve --rotate-token` mid-session must land
  the next action on the paste screen with the rotation hint, never a silent retry loop. A
  MockFacade (`auth: "none"`, the website Demo) must never render a login screen. The reference
  semantics are pymaxim's `tests/unit/test_console_auth.py`; a browser e2e of the whole flow
  (`pnpm e2e` — Playwright over a real `maxim serve`) verifies it — the CLI token is never in a URL
  query, never logged.
- **Verify SetupWizard writes real config.** After a mesh/cloud choice, confirm
  `~/.config/maxim/config.json` has a resolvable `lanes.large` placement and the key landed as a
  **ref** (file/keyring), never inline. "Test connection" calls the `PROBE` seam — don't hand-roll.
- **Verify spoken-code pairing (contract 0.5.0, A9.1).** Only DEVICE deployments offer it:
  `/api/hello` reports `pairing: "available"` when `build_app` was given a `pairing_announcer`,
  and the sign-in screen then shows the by-ear path beside the paste path. Drive it against a
  real backend with a stub announcer (`build_app(dist, pairing_announcer=...)` writing the code
  to a file) — the code must never reach the page, a wrong code must keep the box claimable, and
  a correct code typed right after a wrong one must still sign in (the server paces claims
  ~1.5 s apart, and the client retries a 429 exactly once because a paced claim provably burns
  no attempt). A plain `maxim serve` reports `"none"` and must show no pairing UI at all.
- **Verify the Reachy handoff** (`apps/reachy`). The bootstrap calls pymaxim's
  `device_console_handoff` BEFORE `build_app(extra_trusted_origins=…)`; every host the page is
  reached by (the robot's own `<hostname>.local` — `reachy-mini.local` on a real robot, not
  `reachy.local` — plus detected IPs) must be admitted or the console 400s fail-closed.
  Pollen's daemon (reachy_mini 1.8.x) reads `custom_app_url` by regex over `maxim_reachy_app/main.py`
  at LISTING time — a literal, first match wins, never a runtime value — so the ⚙️ link lands on
  the sign-in screen; `tests/test_app.py` pins that regex against the file. Sign-in on-device is
  the spoken code: the bootstrap starts pymaxim's `VoiceProvisioner` (background download +
  sha256 verify + load of the Piper voice, retrying) and wires `make_pairing_announcer(voice.engine,
make_device_speak_sink(reachy_mini))` + `pairing_ready=voice.is_ready` into `build_app` — wiring
  only, the sink owns the int16 → float32 conversion the SDK needs (raw int16 into
  `push_audio_sample` is noise). Until the voice has spoken once, `/api/hello` reports `pairing: "none"` and
  the page shows only the paste path; the by-ear path appears without a restart. The robot extra
  must pull pymaxim's `tts` extra (piper-tts). The bootstrap also passes `health_monitor=True`
  (contract 0.6.0) — `build_app` does not sample by default, so without it the robot's health
  strip stays empty.
  Verify on the real robot that the code is AUDIBLE and intelligible; offline tests cannot.
- **Verify session-end persists** (Reachy). On `stop_event`, confirm **full** session-end
  consolidation + `save_cerebellum()` fire and `~/.maxim/` grows. If it silently no-ops, the
  cross-session thesis is broken (AGENTS.md § execution flows).
- **Verify EventClient renders the live stream** — the `observe`/`api.on()` events show in the
  activity/thinking panels (the ported `MaximDisplay` IA).

## Claude-specific workflow

- **Parallel sessions use worktrees.** ≥2 concurrent Claude sessions → each in its own
  `git worktree`, absolute paths. `~/.maxim/` is shared — don't run two live agents at once.
- **Don't co-locate a leader and a live agent run on one box** (pymaxim's Exp 37 cascade lesson).
- **Commit/push only when asked.** Branch first if on the default branch. `Co-Authored-By`
  trailer on commits; Claude Code footer on PR bodies.
- **When a change spans this repo and pymaxim,** prefer the pymaxim fix (a facade/seam) and note
  it — do not work around a pymaxim gap in the UI (AGENTS.md cardinal rule).

## Key facts to not re-derive

- **Three layers:** pymaxim facades/seams (L1, not here) → shared kit (L2) → Console + Reachy
  shells (L3). Every component binds to a facade/seam, never a back-channel.
- **One console, many devices.** The kit owns the shell (`ConsoleApp` / `bootConsole`: auth,
  providers, top bar, chat core, rails, drawers). A device is a `DeviceProfile` in its app
  (`apps/console/src/profile.tsx`, `apps/reachy/ui/src/profile.tsx`): panels, stream filter, rails,
  top-bar actions, links, drawers. Fix shell behaviour once in the kit, never per app. A surface that
  needs a newer backend declares `requires: [seam]` and shows its `missing` text when the backend
  lacks the seam (strict `hasSeam`) — never a blank panel. A new device = a new profile + its build
  config + its own size budget.
- **Stack:** React + TS / Vite; backend is pymaxim `maxim serve` (JSON + WebSocket). Viz:
  react-flow + visx on shadcn/ui or Mantine.
- **LLM routing:** 3 destinations, one is cloud (mesh-LAN / mesh-tunnel / cloud), all via
  `config.json::lanes.large.placement` (the `SETUP` seam).
- **Reachy:** WS-era transport (`ws://<host>:8000/ws/sdk`, no zenoh); head pose is world-frame
  (`head=None` counter-rotates) → route motion through pymaxim's `ReachyMiniController`;
  version-match client ↔ daemon after any reflash.
- **Code-split:** heavy dashboard viz never enters the Reachy on-device bundle.
- **Loopback bind; remote reach only through a TLS proxy and a paired, scoped device:** desktop
  `maxim serve` binds `127.0.0.1`. The Reachy app's device console binds its LAN under A9 (Host/Origin
  allowlists + bearer; trust boundary = Pollen's dashboard). Hosted stays a non-goal. See AGENTS.md.
- **Bearer auth is always on (0.4.0):** every `/api/*`, `/docs`, `/openapi.json`, `/ws` 401s without
  the console token; `GET /api/hello` is the ONE tokenless surface (`auth: "none"` = sandbox, no
  login). The kit's `AuthSession` + `AuthGate` own the flow; `HttpFacade` carries the Bearer
  header / ws subprotocol. A stored token can 401 at any time (rotation) — that is auth state
  (`AuthError`), not a generic error.
- **Every build path stamps `maxim-ui.json`:** each app's `build` script runs `stamp-dist.mjs
--target <name>` after `vite build` (which empties dist/), so a per-package build never ships an
  unstamped bundle (pymaxim's `check_ui_contract` reads it).

## Versioning

Two cadences: the **Reachy target** tracks **Pollen SDK** (pin `reachy-mini[gstreamer]>=1.8.3,<2.0`);
the **kit + Console** track **pymaxim**. Pin the `pymaxim` dependency explicitly and bump it
deliberately. Bump the app/target version on any change to runtime behavior, the setup flow, or
SDK-compat.

**After every pymaxim release, check what it vendored:** `python3 scripts/check_pymaxim_vendor.py
<version>` reads the wheel from PyPI and fails unless its console bundle is the newest pulse tag for
its contract (compared by commit) built from a clean tree. 1.3.2 shipped v0.4.0 while v0.4.1 — the
fix made for that release — existed. Release order for any contract change: pulse tags, pymaxim
vendors, pymaxim releases, pulse runs this check.
