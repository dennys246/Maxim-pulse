# One Maxim on a device: speech, listening, and install

Status: **proposed** (owner direction 2026-10-24). Based on the first real-robot session (Reachy Mini,
pymaxim 1.3.3, reachy_mini SDK 1.12) and a five-part parallel code review:
- speech output;
- listening;
- the agent/runtime split;
- install and distribution;
- the pulse robot app.

Every claim below was traced to code. The main ones were re-checked against the source by hand.

Owner's goal: *simplify and better abstract speech and listening in Maxim, for pulse and in general,
and make install far simpler.*

> **Status (2026-10-24): pymaxim adopted this note's thesis and wrote the authoritative plan for its side:
> [`docs/plans/embodied_device.md`](https://github.com/dennys246/Maxim/pull/1440) (Maxim PR #1440).
> Where the two differ, #1440 wins for pymaxim. This note now owns pulse's side (§6).** Differences from §2–§5 below:
> - **Audio port:** pymaxim reshapes its existing `hardware/streams.py::AudioStream` (`push_sample` returns
>   `PlayReport`, whose `__bool__` is `ok`) instead of adding `AudioOutput`/`AudioInput`. Listening rides
>   `CaptureManager` as the one mic consumer. No new top-level packages.
> - **The facade:** `run_device` lives in `maxim.console.device` (pymaxim's F4).
> - **One turn entry:** typed and voice both go through `MaximHandle.talk(..., source=)`, as the single *framed*
>   (untrusted) inbound entry. There is no separate `submit_utterance`.
> - **Head:** the wobbler is disabled explicitly. Speech never moves the head, and all motion stays on `goto_target`.
> - **"Atonia":** pymaxim's *atonia gate* is its existing advisor-mode guarantee (a closed builder that refuses any
>   embodiment). It ships independently. The listening gate in §5.2 is therefore renamed the **self-speech
>   (half-duplex) gate**. "Atonia within embodiment" is a later extension pymaxim prepares for (`embody()` as the one
>   attach point, an embodied actuation census) but hasn't decided.
> - **Decisions as recorded by pymaxim:**
>   - STT on the leader first, with VAD and endpointing on the robot. A brokering peer and on-robot STT come later.
>   - Listening only after the wake word "Maxim".
>   - A private `-dev` Space first.
>   - The 1.4 memory merge as a whole-or-nothing `migrate_agent_state` that **refuses on conflict**, with a backup.
>
>   Two of these differ from the owner's answers in §5 (dynamic listening; a per-store merge). §6.4 tracks them.
> - **Timing:** the device work runs on its own clock and ships as a patch when ready. The bounded defects come in 1.3.4:
>   the speaker sink (#1435), voice input (#1436), `--tts` (#1437), the bounded stop (#1438). Pulse's Python imports
>   (`VoiceProvisioner`, `make_pairing_announcer`, `make_device_speak_sink`, `build_app(pairing_announcer=,
>   pairing_ready=)`) stay, or get one release of deprecation. When `Voice` lands, `pairing_ready` means "the robot
>   played it".

---

## 1. What the robot taught us

**Bugs that every test passed:**
- the app had no `__main__` launcher;
- it skipped the SDK base `__init__`;
- it read a config path pymaxim doesn't define;
- it never started the speaker;
- it trusted the wrong mDNS name;
- pip dropped its UI.

All are fixed in pulse #57.

**pymaxim speech bugs found on the robot:**
- the Piper API (fixed in 1.3.3);
- no resampling to the robot's 16 kHz player;
- a dropped push reported as success.

**What the review found beyond those:**

| # | Finding | Evidence |
| --- | --- | --- |
| R1 | **The robot runs two agents, and talks to the wrong one.** The bootstrap builds `MaximHandle("reachy", body=…)`; `build_app` can't take it. The Console's chat builds its own body-less `console_agent`, which owns all chat and all memory. The "reachy" agent idles, and is the one consolidated on stop. | `console/server.py:1250-1276, 2008-2017` |
| R2 | **The session-end save can be killed.** The daemon stops an app with SIGINT and **SIGKILLs it after 20 s**. Our stop path can take up to about 60 s (talk join, campaign wait, full consolidation), and two shutdowns run. | SDK `apps/manager.py:312-348`; `console/handle.py:672-716` |
| R3 | **Two separate Maxims.** The Console `MaximHandle` and the CLI's `embodied_runtime.selfy.Maxim` have different agent builders, **memory homes** (`~/.maxim/agents/<id>` vs `~/.maxim/memory`), session-end paths (the CLI never calls `save_cerebellum`), LLM routing (no reload in the CLI) and robot connections (the CLI opens its own `ReachyMini`). | `agentic_runtime.py:338-356, 1361`; `controller.py:367` |
| R4 | **The robot app's agent has no body.** No mic, no voice, and its motion tools are no-op stand-ins that report success. | `console/handle.py:191-212`; `runtime/bootstrap.py:160-207, 510-520` |
| R5 | **Voice input has been dead since April.** `media_loop.py:190` imports `maxim.data.audio._file_based_transcription`, which was deleted (commit db274547). The ImportError is caught with one warning. | `embodied_runtime/media_loop.py:190, 324-327` |
| R6 | **Four speech paths that disagree.** The announcer pushes 22.05 kHz unresampled. The agent `speak` resamples int16, but `resample_poly` returns float64 still on the int16 scale, which `_to_device_float32` doesn't rescale, so it would hard-clip. `maxim --tts` has `speaker_fn = None`, so it does nothing. Console replies have no TTS at all. | `utils/audio.py:20-30, 122-136`; `utils/response_output.py:311-315`; `cli.py:1984` |
| R7 | **Readiness that proves nothing about the device.** Three notions of "voice ready" (files exist, model loads, synthesizes in memory), and none of them means "the robot played it". For listening there's none: a missing faster-whisper, model, mic or watcher is silent. | `models/audio/tts.py:256-261, 306-309, 394-413`; `transcribe_audio.py:178-186, 651-653` |
| R8 | **Two threads split the mic stream.** CaptureManager pulls from the same appsink and its copy is never read. On a Pi, STT is forced to CUDA, falls back to CPU float32, and defaults to `distil-large-v3`. | `runtime/capture.py:329-358, 433-462`; `media_loop.py:226-227` |
| R9 | **Off-road install.** We built wheels by hand, used scp and sudo, and hunted for `apps_venv`. Pollen's path is a **Hugging Face Space installed by the dashboard**, which creates `apps_venv` itself, checks for updates and supports private Spaces. But it installs **without extras**, and our app keeps pymaxim in `[robot]` with `dependencies = []`, so a Space install would start with no pymaxim. | SDK `apps/sources/local_common_venv.py:543-655`, `app_update_checker.py` |
| R10 | **The daemon runs apps as `pollen`, not root.** Anything written with `sudo -H` lands in `/root` and the app never sees it (this bit us live). | SDK `daemon/app/services/wireless/reachy-mini-daemon.service:13` |

**The pattern:** every failure sat at a seam where each caller re-implemented a contract, or where a
test faked the thing that failed:
- the SDK's audio rules;
- the daemon's launch, stop and user;
- pymaxim's config schema;
- "which agent";
- "is the voice actually working".

The fix is to give each contract **one owner**.

---

## 2. Target shape

```
pulse robot app (SDK glue only, ~35 lines)
   └─ maxim.device.run_device(reachy_mini, stop_event, ui_dist=…)          ← pymaxim
        ├─ console server   build_app(handle=, voice=, listener=, health_monitor=True)
        ├─ ONE MaximHandle  ── submit_utterance(text, source="typed"|"voice")   (one agent, one memory)
        │     └─ handle.embody(reachy_mini)   ← adopts the app's SDK handle; never a 2nd connection
        │          ├─ ReachyMiniController.adopt(sdk)   motion via the controller (world frame, lock)
        │          ├─ Voice      = TTS + AudioOutput    (honest states; say(text))
        │          └─ Listener   = AudioInput + endpointer + STT   (honest states; → submit_utterance)
        └─ one stop, ≤ 15 s: listener → talk loop → full consolidation → server → voice
```

### A. One Maxim (pymaxim)

- **`build_app(handle_factory=…)`.** The server uses the embedder's handle instead of building its
  own. This alone fixes R1 and the double stop in R2.
- **`MaximHandle.embody(sdk, stop_event) -> Embodiment`.** It attaches body, voice and ears to *this*
  agent:
  - **Motion:** `ReachyMiniController.adopt(sdk)` (new: no own connection, `owns_connection=False`,
    `set_automatic_body_yaw(False)`) plus `modulator_factory` through `AgentConfig`. The real
    Move/Focus tools replace the no-op ones.
  - **Voice and ears:** the `Voice` and `Listener` below.
- **`MaximHandle.submit_utterance(text, source=…)`.** One entry for typed and spoken turns. Voice turns
  show up in the web chat like typed ones (`sim_log USER` with `source="voice"`).
- **One deadline-bounded stop (≤ 15 s).** It fits Pollen's 20 s kill. Consolidation is ordered first,
  and a save that gets cut is logged as such, never silently.
- **Later (1.4): re-base `selfy.Maxim` on `MaximHandle`.** The CLI becomes
  `MaximHandle(...).embody(controller.connect())`, and the two memory homes merge through a one-way
  migration. Until then, a single fix closes the CLI's missing session-end save: call
  `bio.on_session_end()` in `_stop_agentic_runtime`.

### B. Speech: one `say()` path (pymaxim `maxim/audio/`)

- **`Pcm(samples: float32 in [-1, 1], rate)`.** The one value type. `from_any` and `conform(rate,
  channels)` are the only place normalization and resampling happen. That fixes R6's scale and rate
  bugs by construction.
- **`AudioOutput` port: `open()`, `play(pcm) -> PlayReport(ok, reason)`, `clear()`, `close()`, plus
  `rate` and `channels` read from the device.** Adapters:
  - `ReachyMiniOutput(mini)`: starts the player, reads the device rate, and turns the SDK's
    warning-only drops into `ok=False`. Upstream ask to Pollen: make `push_audio_sample` report.
  - `SoundDeviceOutput`, with a queue so utterances stop truncating each other.
  - `NullOutput`.
  - `FallbackOutput`, chosen once rather than by matching exception strings.
- **`Voice(tts, output)`: `start()`, `say(text, sensitive=False) -> SpeechResult`, `clear()`.** It
  has explicit states: **missing → downloading → loaded → synthesizes → plays** (and optionally
  **audible**, checked with the mic in a release smoke). `VoiceProvisioner` folds into
  `Voice.start()`.
- **Callers collapse onto `voice.say`:** the pairing announcer, the agent's `speak` tool (now reporting
  `spoken = result.ok`), `maxim --tts` (so R6's dead flag works), and the Console's replies on a
  device. `build_app(voice=)` derives `pairing_ready = voice.ready(PLAYS)`.

### C. Listening: one `Listener` (pymaxim `maxim/listening/`)

- **`AudioInput` port** over an *existing* `reachy_mini.media` (`ReachyMiniAudioInput`), plus
  sounddevice and fake adapters. It also exposes the XVF3800's `doa() -> (angle, speech)`.
- **`AudioHub`:** **one** consumer per mic, fanned out inside pymaxim. It replaces the competing
  CaptureManager loop and `audio_capture_worker` (R8). It never calls `stop_recording`, which in the SDK
  also stops playback.
- **`Listener(input, stt, endpointer, on_utterance)`:**
  - a streaming endpointer (Silero VAD, about 600 ms trailing silence, with the XVF speech flag as a
    cheap pre-gate);
  - an `SttProvider` (faster-whisper in a thread, not a spawned process polling files);
  - provisioning with states **disabled / missing_dep / downloading / loading / ready / failed**;
  - half-duplex muting while `Voice` is speaking.
- **Device defaults:** `base.en`, int8, CPU, 4 threads, beam 1. The device is chosen by
  `resolve_device()`, never forced to CUDA. (Confirm the board: the SDK names a CM4, which is slower
  than a Pi 5.)
- **This replaces:** the dead file-IPC path (R5) and its two duplicate workers, the JSONL tail and
  the substring wake word. The wake word becomes an explicit `WakeWord([...], fuzzy=True)` policy;
  the default is always on.

### D. One status seam the UI can show (pymaxim → pulse)

A `device` status (on `/api/hello` and health, like `pairing` today), covering:
- **voice:** `{state, reason, fix}`;
- **listening:** `{state, reason, fix}`;
- **agent:** `{built, config_stale}`;
- **motion:** `{awake, asleep}`;
- **thinking on:** the placement.

Every silent failure in R7 and R8 becomes a visible chip ("Listening: missing speech-to-text →
`pip install …`"), using the same `Cmd` style as the rest of the Console.

### E. Install: Pollen's way, with pymaxim owning its dependencies

- **pymaxim owns one `robot` extra.** Rename or alias today's `pi = [reachy, console, llm-anthropic,
  tts]`, and add `audio` once the Listener lands. Pulse depends on `pymaxim[robot]` and stops
  knowing about piper, faster-whisper or gstreamer.
- **Pulse publishes the robot app as a Hugging Face Space from CI on tag:**
  - the app package, with the **same run's** `ui_dist` baked in (its stamp must match the GitHub
    asset);
  - pymaxim in **base `dependencies`**, because the daemon installs without extras;
  - README front-matter (`reachy_mini` tags, `short_description`, links to docs and PRIVACY);
  - one commit per tag, so the dashboard's update check equals our release cadence.
- **A private `-dev` Space for branches and candidates.** Testers use the dashboard's "install
  private space" and the Update button. That replaces wheel-building, scp, sudo and
  `--force-reinstall`.
- **What the owner does on a robot:**
  1. Install from the dashboard.
  2. ⚙️, then sign in by ear.
  3. Pick a leader the robot found on the network and confirm a code on the leader, or paste a cloud
     key.
  4. Talk.

  No SSH. Step 3 needs pymaxim pieces:
  - **leader advertise/browse over mDNS;**
  - **peer↔leader pairing by code,** reusing the spoken-code pairing machinery, instead of
    `maxim tunnel key show` and copying a key;
  - **the agent built lazily after setup,** which `submit_utterance` and the config generation
    already allow, so no restart.
- **Desktop:**
  1. `pipx install "pymaxim[console]"`, then `maxim serve`.
  2. Open the printed link; the wizard does the rest.

  pymaxim should also:
  - name the two secrets so they can't be confused ("console sign-in token" vs "leader key");
  - prefer IPv4 for `.local` names.
- **Logs:** pymaxim writes a rotating `~/.maxim/logs/device.log`, and the Logs drawer shows it. The
  owner never has to dig through the daemon's journal.
- **Release coupling:**
  - Keep the robot pin as a **floor + major** (`>=1.3.3,<2`), and stop re-pinning every release.
    This is safe because pymaxim's pre-publish CI runs pulse's robot smoke against the candidate.
  - Pulse CI opens the pymaxim vendor PR automatically on a Console tag.

### F. Tests that can't pass while the robot is broken

- **SDK-faithful fakes, built on the SDK's own code.** `MediaManager(media_backend="no_media")` with
  a recorder `AudioBase`. It drops audio pushed before `start_playing()` and decodes what it gets as
  F32LE at 16 kHz. Assertions are made on what would be **heard**: duration, pitch, no clipping, not
  silence. Never on a returned bool.
- **A daemon-faithful harness.**
  - Launch exactly as the daemon does: `python -u -m <entry module>`, with the daemon's env scrub,
    as `pollen`.
  - Stop with **SIGINT** and assert the process exits within the daemon's 20 s budget (read from the
    SDK).
  - Prove that a Talk turn and the embodied agent are the **same** agent, and that
    `~/.maxim/agents/reachy` grew.
- **Contract tests generated from the SDK:** `_get_custom_app_url_from_file(main.py)`, the
  `__main__` block equal to the SDK template, the `ReachyMiniApp.__init__` signature, the media API.
- **A one-command on-robot check:** `scripts/robot-check.sh <host>`. It starts and stops through the
  daemon API, times the stop, diffs `~/.maxim`, checks every host name, and asks three ear/eye
  questions ("did you hear the code?"). Tier C becomes this script.

---

## 3. What pulse looks like afterwards

```python
# apps/reachy/maxim_reachy_app/main.py — the whole app (app.py deleted)
from pathlib import Path
from reachy_mini import ReachyMiniApp

class MaximReachyApp(ReachyMiniApp):
    custom_app_url: str | None = "http://0.0.0.0:8765/"   # read by the daemon's regex
    dont_start_webserver: bool = True

    def run(self, reachy_mini, stop_event):
        from maxim.device import run_device
        ui = Path(__file__).parent / "ui_dist"
        run_device(reachy_mini, stop_event, ui_dist=ui if ui.is_dir() else None)

if __name__ == "__main__":
    app = MaximReachyApp()
    try:
        app.wrapped_run()
    except KeyboardInterrupt:
        app.stop()
```

The kit gains a device-status chip row, plus a first-run card that opens setup on a fresh robot.

---

## 4. Plan

**Before tagging pulse v0.4.3 (now):** #57 (the robot fixes). Then the owner's typed-chat check
(as `pollen`). The release notes say plainly that voice conversation and the embodied agent arrive
with pymaxim 1.3.4. Tier C in `docs/release-checklist.md` is narrowed to match.

**pymaxim 1.3.4 (additive, low risk), ordered by what each unblocks:**
1. `build_app(handle_factory=)`, so there is one agent (R1).
2. One ≤ 15 s stop (R2).
3. `Pcm` + `AudioOutput` + `Voice`, with the bug fixes (R6, R7 speech).
4. `MaximHandle.submit_utterance`.
5. `AudioInput` + `AudioHub` + `Listener`, replacing the dead path (R5, R8). STT runs as a **routable `lanes.stt`** served at the standard `POST /v1/audio/transcriptions` on the leader or any brokering peer (§5.1). The listening state machine and **self-speech atonia** are included from day one (§5.2).
6. `ReachyMiniController.adopt` + `MaximHandle.embody` (R3 motion, R4).
7. `maxim.device.run_device`.
8. The device status seam.
9. The `robot` extra.
10. A device log file.
11. The CLI's `bio.on_session_end()` one-liner.

**Pulse, alongside:**
- the Space publishing job, the private `-dev` Space, and pymaxim in base deps;
- the daemon-faithful harness and the SDK-generated contract tests;
- `robot-check.sh`;
- the device-status UI;
- shrinking the app to SDK glue when `run_device` lands.

**1.4 (refactor):**
- `selfy.Maxim` on `MaximHandle`, then the **memory fold** (§5.4);
- **sleep atonia** and `dormant` listening tied to `ProcessingState`, with all inhibition routed through one `AtoniaGate` (§5.2);
- moving the remaining raw head moves onto the controller (pymaxim's hardware-safety rule);
- mDNS leader discovery and peer pairing by code;
- an architecture test so no second agent builder can reappear.

## 5. Owner decisions (2026-10-24), and how each is carried out

### 5.1 Speech-to-text runs on the leader, or on any peer that brokers it (e.g. this Mac)

**STT becomes a routable lane, like the LLM.**
- `lanes.stt` mirrors `lanes.large`: it's either `local`, or a `remote_url` pointing at **any node**
  (the leader, or a peer that brokers the call, such as the owner's Mac).
- The robot's Console setup picks it the same way it picks the leader.

**The robot keeps the cheap, private part and sends only what's needed:**
- capture, the endpointer (VAD, with the XVF3800 speech flag as a pre-gate), and the atonia gate
  (5.2) stay on the robot;
- only **finished utterances** leave it (16 kHz mono, a couple of seconds, tens of KB), never a
  continuous stream;
- the text comes back, and `submit_utterance` hands it to the robot's own agent;
- the reply's LLM call goes to the leader as today.

**The industry-standard wire format: OpenAI's `POST /v1/audio/transcriptions`.**
- It's multipart, `file` + `model` (+ `language`, `response_format`). The same API is served by
  whisper.cpp's server and faster-whisper servers.
- pymaxim's **LeaderProxy** (`:8099`, already OpenAI-compatible for `/v1/models` and
  `/v1/chat/completions`) serves it on any node with the `audio` extra, behind the same auth and
  logging.
- Because it's the standard, a brokering Mac (Apple Silicon running whisper `large-v3-turbo` or MLX)
  or a third-party server can stand in with no code change.

**Routing preference, with honest fallback:** the configured broker or leader, then a local tiny
model (`base.en`, int8) if it's installed, then *listening unavailable*, with the reason shown in
the status row.

**Privacy:** audio stays on the LAN by default. A cloud STT provider is an explicit opt-in,
labelled the way the cloud LLM is.

**Generalizes:** the same lane pattern can later move **TTS** to a broker too, so the robot only
plays audio. That's not needed now.

### 5.2 Dynamic listening with an atonia gate

**Listening becomes a state machine,** driven by the agent's `ProcessingState` (`AWAKE`/`SLEEP`)
and the conversation, and shown live in the status row:

| State | Mic | Acts on what it hears | Enters when |
| --- | --- | --- | --- |
| `off` | off | — | no consent, no device, or the owner muted it |
| `dormant` | on | **wake word only** (fuzzy "Maxim"/"Reachy") | `ProcessingState.SLEEP`, rest, consolidation |
| `attentive` | on | an utterance that's **addressed**: wake word, or the speaker facing the robot (DoA within a cone) | awake and idle |
| `engaged` | on | any utterance, with no wake word | within a follow-up window (e.g. 8 s) after Maxim replies, or when talk mode is on in the Console |
| `speaking` | on | **nothing** (atonia, below) | while `Voice` is playing, plus a short echo tail |

**The atonia gate:** like REM-sleep atonia, perception keeps running but output is inhibited.
- One `AtoniaGate` in pymaxim is the single answer to **"may I act on this now?"**.
- It's consulted by:
  - the Listener's dispatch, before an utterance reaches the agent;
  - `Voice.say`;
  - the motion controller.
- Three cases:
  - **Self-speech atonia** (`speaking`): Maxim never hears itself as a new turn. This replaces relying
    on the XVF3800's AEC alone.
  - **Sleep atonia** (`dormant`, consolidation): no head motion and no speech while it consolidates.
    Only arousal lifts it: the wake word, a loud event, or the owner's voice.
  - **Safety atonia:** the existing fear gate and `DefaultNetwork.inhibit()` route through the same
    gate, so "don't move" has one owner.
- It builds on what exists rather than adding a parallel mechanism: `ProcessingState`, `InhibitionMixin`
  (`default_network/inhibition.py`), the motor backend's `_inhibit_dn` and the fear gate.

**What the UI shows:** a live chip ("Listening · engaged", "Asleep · atonia", "Speaking"), with a
**mute** toggle that forces `off`.

### 5.3 The Hugging Face Space: private while in development, public with a public Maxim release

- CI publishes every pulse robot release to a **private** Space. Testers install it by id through
  the dashboard ("install private space"); branch builds go to a private `-dev` Space.
- At the first **public** Maxim release that includes the robot app, the owner flips the Space to
  public and opens the PR to Pollen's `app-list.json`. Both are release-checklist items.
- The Space's README front-matter, PRIVACY link and `short_description` are written from day one,
  so going public is just the visibility switch.

### 5.4 Fold the memory folders in 1.4

**The canonical home is `~/.maxim/agents/<agent_id>/`,** the factory layout `MaximHandle` uses.
`~/.maxim/memory/` (the CLI's `selfy.Maxim`, `utils/paths.py::user_memory`) becomes legacy.

**Order matters.**
1. First **re-base the CLI on `MaximHandle`** (1.4 item 1), so nothing writes the legacy folder any
   more.
2. Then fold.

Folding first would let the old CLI keep writing the old place.

**The three cases:**

| Legacy `memory/` | `agents/reachy/` | Action |
| --- | --- | --- |
| has state | empty | **move** as is, with the existing `migrate_agent_state` (atomic, whole or nothing). Automatic on first 1.4 start; lossless, so no prompt |
| empty | anything | nothing |
| has state | has state | **merge**. The existing helper refuses this on purpose. This is the new part, and it **asks first** (CLI prompt, and a Console banner "Two memories found: fold them?"), because merging is a judgment |

**Merge rules, per store** (`AGENT_STATE_FILES`):

| Store | Rule |
| --- | --- |
| `hippocampus.json`, `memories.json` | episodes are **unioned**: dedupe by episode id, then by (timestamp, content hash), keep chronological order |
| `nac.json` | causal links **combine evidence**: sum the counts and recompute confidence from the combined counts (never average two confidences) |
| `ec.json`, `atl.json`, `angular_gyrus.json` | concept and graph **union** with dedupe. For conflicting scalars, keep the side with more evidence, ties to the newer |
| `scn.json` | merge the timelines; recompute the circadian phase from the merged events |
| `cerebellum.json` | the CLI never saved one (R3), so the app's is kept |
| `memory_hub/` | union of sessions by id |

**Mechanism:** `maxim memory fold --from ~/.maxim/memory --into reachy [--dry-run]`.
- **Dry run:** per-store counts, duplicates and conflicts, and what each rule will do.
- **Real run:**
  - build the merged agent in a staging directory;
  - **validate it** by loading it with the real loaders (`create_full_agent(auto_load=True)` in a
    sandbox);
  - check invariants: no episode lost (merged = union minus duplicates), causal evidence conserved;
  - **atomic swap** with the same `atomic_install_dir` the existing helper uses.
- **Backups:** both originals are kept, as `memory.folded-<UTC>/` and `agents/reachy.pre-fold-<UTC>/`.
- **Idempotent:** a marker `agents/reachy/FOLDED_FROM.json` (sources, counts, versions, rules
  version) makes a re-run a no-op, and `maxim memory unfold` restores the backups.
- **`maxim doctor`** warns while the legacy folder still holds state.

**An early user of the same tool, before 1.4:** the robot app's accidental `console_agent` memories
(R1: typed chat went to the wrong agent). When 1.3.4 makes chat use `reachy`, fold `console_agent`
into `reachy` with the same tool, so what the owner told the robot isn't lost.

**Tests:**
- fixture snapshots of both layouts, scrubbed from the owner's real desktop and robot;
- property tests for the merge: idempotent, no loss, evidence conserved;
- kill-mid-fold, reusing the atomic-install tests;
- an architecture test that nothing but the factory writes agent state.

---

## 6. Pulse's side, against pymaxim's plan (#1440)

### 6.1 Now (v0.4.3, on pymaxim 1.3.3)
- **#57 (the robot fixes):**
  - the mDNS name;
  - the `__main__` launcher;
  - the base `__init__`;
  - schema-only config reads;
  - the bootstrap as #1435's **interim lifecycle owner** for bare-SDK embedders: `start_playing()` and
    `disable_wobbling()` once at start, `stop_playing()` last.

  Proven by the daemon-launch smoke on linux/arm64 against 1.3.3.
- **Release notes say plainly** that voice conversation and the embodied agent come with pymaxim's device work.
  Tier C in the release checklist is narrowed to match.

### 6.2 Alongside pymaxim's steps (from #1440 §5, "Pulse, alongside")

| pymaxim step | Pulse work |
| --- | --- |
| 1. One agent (handle on `app.state`, `talk(source=)`) | nothing to wire. The robot's typed chat moves to the `reachy` agent; pulse re-verifies on the robot with `robot-check.sh` |
| 2. The bounded stop (#1438 / #1344) | the daemon-faithful harness asserts SIGINT-to-exit within the SDK's budget (read from the SDK) |
| 3. `Pcm`, the reshaped `AudioStream`, `Voice` | pairing UI unchanged. `pairing_ready` now means *played*: on a device that can't play, the sign-in shows paste only. Pulse's smoke asserts on what's **heard** (SDK-faithful fake) |
| 4. `adopt` + `embody` (+ the embodied census) | the bootstrap drops its interim `start_playing`/`disable_wobbling` once `embody()` owns them; a test pins that there's exactly one owner |
| 5. Listening (wake word, STT on the leader, half-duplex) | a status chip ("Listening · say 'Maxim'" / "Listening · on the leader" / reason + fix) and a mute toggle, once the status seam exists |
| 6. `run_device` (`console/device.py`) | the robot app shrinks to SDK glue (~35 lines, §3), and `app.py` is deleted |
| 7. The status seam (0.7.0 if still unreleased) | regenerate from the merged `openapi.json`; device-status chips. **Plan the 0.7.0 tag with pymaxim up front:** pulse tags first, pymaxim vendors, then releases |
| 8. The `robot` extra + the device log | the robot app depends on `pymaxim[robot]` in **base** `dependencies` (the dashboard installs without extras); the Logs drawer shows the device log |

**Independent of the steps (pulse's own):**
- **Space publishing:** a private `-dev` Space from CI. It goes public when pymaxim's R2 reachy cell and
  `robot-check.sh` pass on a release candidate.
- **The daemon-faithful harness:** `python -u -m`, as a non-root user, with SIGINT.
- **SDK-generated contract tests.**
- **`robot-check.sh <host>`.**
- **Keep pulse's Python imports compatible** within one deprecation window, and act on each named change in
  pymaxim's release note.

### 6.3 The robot's board (answers #1440's open question)

Read on the owner's robot, 2026-10-24 (`/proc/device-tree/model`): **Raspberry Pi Compute Module 4 Rev 1.1**, 4 cores
(Cortex-A72), **3.7 GiB RAM**, about 3.0 GiB available with the app running.
- **STT on the leader is clearly right.** An on-robot offline fallback is limited to `tiny.en`, or `base.en` at
  best (int8, CPU).
- **Memory is tight:** R1's second, idle agent costs real RAM, so step 1 (one agent) also relieves pressure.

### 6.4 Open with the owner
1. **Listening policy.**
   - The owner asked for **dynamic listening** (dormant / attentive / engaged / speaking, §5.2).
   - pymaxim records **wake-word only** for the first version.
   - Proposed: ship wake-word first (simple, private), with the state machine as the stated next step on the same
     `Listener`.
2. **The memory merge.**
   - The owner asked to **fold** both homes.
   - pymaxim records a whole-or-nothing migration that **refuses on conflict**.
   - That covers every case except a person who used both the CLI and the robot app. Proposed: ship
     refuse-on-conflict in 1.4, with the per-store merge (§5.4) as a follow-up, only if a real conflict shows up.
3. **A brokering peer for STT** (e.g. the owner's Mac): not in pymaxim's first step (leader first). The lane design
   (§5.1) allows it later with no format change, because the endpoint is the standard
   `/v1/audio/transcriptions`.
