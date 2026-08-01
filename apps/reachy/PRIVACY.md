# Privacy — Maxim on Reachy Mini

What this app reads, what it keeps, and what leaves your robot. This is the
source text for the Hugging Face Space listing (gate **P3** in
[reachy_mini_app.md](../../docs/plans/reachy_mini_app.md)).

**Draft — verify each claim against the shipped build before publishing.**
Every line below is a promise to a stranger about their home robot; anything
that cannot be verified in code should be cut rather than softened.

## The short version

Maxim runs **on your robot**. Its memory of you lives on the robot's own disk,
in `~/.maxim/`, and is never uploaded anywhere by this app. Whether any of your
words leave the robot depends on one choice you make during setup:

| Setup choice              | Where thinking happens                                          | What leaves the robot                                                                           |
| ------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Private & free** (mesh) | A computer you own, on your network or over your own tunnel     | Your words go to **your** machine. Nothing goes to us or to a third party.                      |
| **Cloud key**             | The cloud provider whose key you paste (e.g. Anthropic, OpenAI) | Your words are sent to **that provider**, under their privacy policy and their retention rules. |

There is no third option. Maxim has no servers of its own, no telemetry, no
analytics, and no account.

## What the app can read

- **Microphone** — while a session is running, to hear you.
- **Camera** — for perception, if enabled by the behaviour you are running.
- **The robot's own sensors** — motor and body state, used for movement.

Audio and video are processed to drive the conversation. This app does not
record them to disk, and does not transmit raw audio or video off the robot.
In cloud mode, what _is_ transmitted is the **text** derived from your speech,
because that is what a language model needs to answer.

## What is stored on the robot

Everything Maxim remembers is under **`~/.maxim/`** on the robot:

- episodic memories of your sessions (what happened, what you chose),
- a model of you learned across sessions — the thing that makes it feel like it
  knows you,
- configuration, including where it sends thinking work.

**Your API key is never stored in plain text inside the config file.** Setup
writes it to a separate mode-`0600` file and stores only a reference to that
path; pymaxim rejects inline plaintext keys at load time.

## Deleting what it knows

Everything Maxim has learned lives in one directory on the robot. **Deleting
`~/.maxim/` removes all of it** — memories, the model of you, the lot. There is
no copy anywhere else, so nothing survives that deletion.

> **Not yet built:** in-app "forget everything" and "export what you know about
> me" buttons are planned (reachy_mini_app.md, additions #5) but do not exist in
> this build, and there is no memory-delete or memory-export verb on the app's
> API. Until they ship, deleting the directory is the honest answer — do not
> claim the buttons in a store listing.

## Two honest cautions

1. **Anyone on your network can reach the robot's control interface.** The
   Reachy daemon's control socket (`ws://<robot>:8000/ws/sdk`) has **no
   authentication** in the SDK versions this app targets, and the page this app
   serves is reachable from any browser on the same network. Treat the robot the
   way you would treat a smart speaker: fine on your home network, not on a
   public or shared one.
2. **Cloud mode sends your words to a third party.** If you paste a provider
   key, your conversations are governed by that provider's policy, not by this
   app's. If that matters to you, use the mesh option — it is the default we
   recommend, and it is free.

## What this app never does

- No account, no sign-in, no cloud sync of your memories.
- No analytics, telemetry, crash reporting, or usage tracking.
- No sending your data to the app's authors — there is nowhere for it to go.

Questions or a privacy concern: <https://github.com/dennys246/Maxim/issues> ·
docs at <https://docs.pymaxim.bio/>
