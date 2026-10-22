# Model picker — show what is really there, and how to get the rest

Status: **proposed** (owner direction 2026-10-22). Pulse hides the Models button until the
pymaxim seam below exists.

## Why the old picker was removed

It listed pymaxim's built-in catalog (`GET /api/models`: 18 local profiles, 15 cloud models),
not what the configured lane actually serves. Picking one changed only the button's label: the
choice lived in browser memory, `/api/run` has no model field, and every turn kept using
whatever `lanes.large` resolves to. A model the leader doesn't have looked selected, and nothing
told you otherwise.

## What the owner wants

- Keep a dropdown, but make it **true**:
  - a **green** light on models that are serving and healthy;
  - **orange** on ones that are serving but unhealthy;
  - models that aren't available **greyed out**.
- Clicking an unavailable model shows **exactly how to launch a leader with it**.
- Clicking an available one uses it.
- **No context size** in the picker. Users set their own (`llm.n_ctx`).

## Who owns what

| Fact | Owner | Why |
| --- | --- | --- |
| which models the configured lane serves (the leader's `/v1/models`, the cloud provider's list) | pymaxim | only it knows the lane, the key and the URL |
| each model's health (reachable, failure rate, latency) | pymaxim | it has the lane stats the heartbeat already samples |
| the launch instructions | pymaxim | they're pymaxim's own CLI; pulse must never write commands it can't keep correct |
| applying a choice (and refusing a model that isn't served) | pymaxim | it's a config write through the SETUP seam |
| the dots, greying, the instructions panel, copy buttons | pulse | presentation |

## The contract pulse needs (proposed — pymaxim decides the final shape)

`GET /api/models`: every model entry gains:

```jsonc
{
  "name": "qwen2.5-14b",
  "status": "serving" | "degraded" | "not_serving",   // drives green / orange / grey
  "status_detail": "p99 41 s over the last 10 min",     // shown on hover and in the panel
  "in_use": true,                                        // the model turns run on now
  "launch": {                                            // only when status == not_serving
    "where": "on the leader (http://10.6.0.33:8099/v1)",
    "steps": [ { "text": "Download and serve it:", "command": "maxim …" } ],
    "docs_url": "https://docs.pymaxim.bio/…"
  }
}
```

Plus a group for the configured lane (e.g. `"leader"`), listing what it actually serves, ahead
of the catalog groups.

`POST /api/setup/model {"name": …}` sets the model turns use (e.g. `lanes.large.remote_model`).
It refuses a model that isn't served, with a reason (409 plus a `detail` pulse shows as-is), and
invalidates whatever the talk loop caches, so the next turn uses it without a restart (compare
the 1.3.3-candidate finding where a failed talk left stale state behind).

The contract must not carry secrets: no keys in `launch` steps.

## What pulse renders

- The top-bar button shows the model **in use**, from the server, never local state.
- Each row shows:
  - a status dot **with a text label** ("serving", "unhealthy", "not running"); colour never
    carries meaning alone;
  - the name;
  - `cloud` or the backend.
- No context size.
- **Clicking a serving or degraded row** applies it (`POST /api/setup/model`) and closes. The
  server's refusal text is shown verbatim if it says no.
- **Clicking a greyed row** opens its launch panel: `where`, the steps with copy buttons, the
  docs link. It doesn't select anything.
- On an older backend without the new fields, the button stays hidden (strict seam, per the
  shell's `requires`).

## Open questions for pymaxim

1. What makes a model "degraded"? Lane stats (failure rate, p99), a failing probe, or both, and
   over what window?
2. How fresh does the status need to be? One probe per drawer open is probably enough; the
   heartbeat's lane stats are already live.
3. Cloud models: is `serving` "key present and the probe accepts it"? There's no leader there,
   so `launch` becomes "add a key" (which the setup wizard already handles).
4. Where the instructions come from: generated from the model profile table, or a docs page per
   profile?
