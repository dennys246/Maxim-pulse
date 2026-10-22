# Release checklist: does pulse fully work on this pymaxim?

Run this for every pymaxim release that pulse ships against, before tagging the pulse release
that pins it. It exists because pymaxim 1.3.2 shipped three defects that every unit test passed:
- the robot couldn't speak;
- the wrong console bundle was vendored;
- a plain `pymaxim[console]` install had no live stream.

On top of that, pulse's own robot package was dropping its UI.

Each tier tests something the one before it can't.

| Tier | What                              | Who / where                    | Time      |
| ---- | --------------------------------- | ------------------------------ | --------- |
| A    | automated, what users install     | anyone, one command or CI      | ~15 min   |
| B    | a live agent doing real work      | a dev machine with a real LLM  | ~10 min   |
| C    | the robot itself                  | the owner, with the Reachy     | ~15 min   |

## Release-day order

The order matters, because Maxim's publish step re-checks that its vendored pin is the newest
stable pulse tag for the contract.

1. **pymaxim vendors the pulse tag** and builds a candidate wheel.
2. **Tier A on the candidate:** `scripts/release-acceptance.sh <wheel>`, with
   `REACHY_APP=<the pending robot PR's apps/reachy>` if one is waiting. Report the verdict to Maxim
   **before** the cut. The candidate's version string still reads the previous release (Maxim
   bumps it only in the release commit); that is not a failure.
3. **Do not push a pulse tag** until pymaxim has published. A new tag blocks Maxim's release.
4. pymaxim publishes.
5. **Tier A on the published release:** `scripts/release-acceptance.sh <version>`, or Actions →
   *Release acceptance* → the version.
6. **Tier B.**
7. Merge the robot PR with its pin moved to the release (its *Release smoke* must pass), then
   **Tier C** on the robot.
8. Tag the pulse release.

## Tier A — automated

```bash
scripts/release-acceptance.sh 1.3.3             # published
scripts/release-acceptance.sh path/to/pymaxim-X-py3-none-any.whl   # candidate
```

It prints one verdict:
- `ACCEPTANCE ACCEPTED`: every step passed.
- `REJECTED`: at least one step failed.
- `INCOMPLETE`: a step was skipped, for example robot without Docker.

The steps:
- `vendor`: the wheel vendors the newest stable pulse tag for its contract, built clean.
- `e2e`: this checkout's build in Chrome (59 checks: shell, logs, pairing, auth), Python 3.12.
- `shipped`: the same 59 checks against the bundle **vendored in the wheel**, which is what a
  desktop user gets, on the oldest supported Python (3.10).
- `upgrade`: the token and run history are written by the previous release, then the same HOME is
  upgraded. The token must survive and all 59 checks must pass, on the newest Python (3.14).
- `robot`: the app pip-installed exactly as on the robot, with its bundle in `ui_dist/` and the
  real `[robot]` extra (Pollen SDK). Then `pip check`, then the release smoke against the
  **installed** package, on linux/arm64.

**Never patch around a failure** (installing a missing dependency, skipping a check). The
failure is the finding: report it to pymaxim, or fix pulse if it's pulse's.

## Tier B — a live agent (dev machine, real LLM)

Tier A seeds the run history with pymaxim's writers; it never watches Maxim *work*. Use a
machine with a working `lanes.large` placement (or a cloud key), and a clean venv with the
release, not a dev checkout:

```bash
uv venv /tmp/accept && uv pip install -p /tmp/accept 'pymaxim[console]==<version>'
/tmp/accept/bin/maxim serve     # open the printed URL
```

- [ ] No contract-mismatch banner; the backend chip shows `<version>`.
- [ ] Start a short task, something that uses two or three tools.
- [ ] **Live:** events stream into the activity and thinking panels while it runs, and the turn
      status moves. This is the "EventClient renders the live stream" check in CLAUDE.md, which
      nothing automates.
- [ ] The health strip updates while the agent runs.
- [ ] **After:** Logs → Runs lists the run at the top. Open it: the goal, the outcome and the
      actions in order are shown, with **per-action credit chips** written by a real run (format
      1.2+), not "credit not recorded".
- [ ] Logs → Degraded: anything new? A swallowed exception during a normal run is a finding.
- [ ] Logs → Health: no stall during a healthy run.
- [ ] `maxim serve --rotate-token` while the page is open: the next action lands on the paste
      screen with the rotation hint, with no retry loop.

## Tier C — the robot (owner, Reachy Mini)

Install the release's robot app from the Pollen dashboard on a robot with Wi-Fi.

- [ ] The app installs and starts from the dashboard; the ⚙️ link opens the sign-in screen.
- [ ] **By ear:** "Have the robot say a code". The robot speaks six digits, **audible and
      intelligible** from across the room, and typing them signs you in. A wrong code first, then
      the right one, still signs in.
- [ ] Cold boot without network, then connect Wi-Fi: the by-ear option is absent at first and
      appears on its own once the voice is ready, with no restart.
- [ ] The health strip shows the **robot's own** CPU and RAM.
- [ ] A short conversation: it hears, answers aloud, and moves its head.
- [ ] **Stop from the dashboard:** the session-end consolidation runs (the app log says so), and
      `~/.maxim/` on the robot grows.
- [ ] Start it again: it remembers something from the last session.
- [ ] Logs → Runs lists the robot's own sessions.

Record the outcome of each tier in the pulse release notes.
