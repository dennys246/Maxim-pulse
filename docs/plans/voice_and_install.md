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
5. `AudioInput` + `AudioHub` + `Listener`, with device defaults, replacing the dead path (R5, R8).
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
- `selfy.Maxim` on `MaximHandle`, with the memory-home migration;
- moving the remaining raw head moves onto the controller (pymaxim's hardware-safety rule);
- mDNS leader discovery and peer pairing by code;
- an architecture test so no second agent builder can reappear.

## 5. Decisions for the owner

1. **Speech-to-text on the robot (CPU, `base.en`), or on the leader?** On the leader means sending
   audio over the LAN, with better accuracy and a lighter robot.
2. **Always listening while the Console is in talk mode, or only after the wake word "Maxim"?**
3. **A public Hugging Face Space (listed for every Reachy owner) or private first?**
4. **Merge the CLI's and the app's memory** (`~/.maxim/memory` → `~/.maxim/agents/reachy`)
   **in 1.4?**
