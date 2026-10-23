# Connection check — notice a stale saved setup before a chat fails

Status: **proposed** (owner direction 2026-10-23). The pulse half waits on a pymaxim seam.

## The problem

A saved setup can go stale while it sits on disk, because:
- the leader rotates its key;
- its IP changes;
- it is switched off;
- a cloud key is revoked.

Today nothing notices until a chat fails, and then the failure is far from its cause.

Tested against the 1.3.3 candidate (wheel `9cf8c343…`): after `/api/setup/mesh` with a **wrong
key**, and again with a leader that is **down**, `GET /api/diagnose` reports
`lanes.large.remote_url` and `lanes.large.remote_api_key_ref` as **ok**. Diagnose checks that the
setting is *present*, never that it *works*.

The right words already exist. pymaxim's probe classifier returns:
- an `outcome`, e.g. `auth_rejected` or `unreachable`;
- a `message`;
- a `fix_hint`, e.g. "On the leader, print the current key: `maxim tunnel key show`".

But it only runs on a URL and key the user types into Settings. Pulse can't run it on the saved
setup, because that needs the saved key, which correctly never leaves the server.

## Who owns what

| Piece | Owner |
| --- | --- |
| probing the **saved** lane server-side (reachability + auth), classifying it | pymaxim |
| the message and the fix steps (they're pymaxim's CLI) | pymaxim |
| when to ask, the banner, its buttons, staying quiet when healthy | pulse |

## The pymaxim seam (proposed — pymaxim decides the shape)

Probe the saved configuration, e.g. `POST /api/probe {"saved": "large"}`, or a dedicated `GET
/api/connection`. It returns the existing `ProbeResult`:

```jsonc
{
  "status": "ok" | "warn" | "fail",
  "outcome": "ok" | "auth_rejected" | "unreachable" | "not_configured" | …,
  "message": "auth rejected (http://10.6.0.33:8099/v1): HTTP 401 — …",
  "fix_hint": "On the leader, print the current key …\n  maxim tunnel key show\n…",
  "latency_ms": 42,
  // new: what was checked, and when (so pulse can show "checked 2 min ago")
  "target": "http://10.6.0.33:8099/v1",
  "checked_at": 1792745000.0
}
```

- It works for mesh and cloud placements. With nothing configured it returns
  `not_configured`, not an error.
- It's cheap enough for startup and tab focus. A cached result inside a short window (e.g.
  30 s) is fine and preferred.
- The key is never echoed.
- It declares a seam (e.g. `connection`), so an older server shows nothing rather than a
  broken banner.

## What pulse does

**When it checks:**
- right after sign-in, or on load with a stored token;
- when the tab regains focus, at most once a minute;
- straight after **Save** in Settings;
- on **Check again**.

**What it shows:**
- **`ok`:** nothing. The health strip may show a small "leader ✓" with the target on hover.
- **`fail`:** one banner under the top bar, `role="alert"`:
  > **Can't use your leader at http://10.6.0.33:8099/v1** — auth rejected (HTTP 401).
  > On the leader, run `maxim tunnel key show` and paste the key in Settings.
  > [Open Settings] [Check again] · checked 1 min ago

  The fix text is pymaxim's `fix_hint`, with its command lines rendered as **Cmd** (the violet
  command style). The banner leads to the **leader section of Settings** with the address
  prefilled.
- **`warn`** (e.g. reachable but slow): the same banner as a quieter `role="status"` line.
- **`not_configured`:** the existing first-run flow (the setup wizard), not a banner.

**Where:** the banner is shell behaviour, so it lives in the kit, shared by every device
profile. The Reachy page shows the same banner, with "on the leader" meaning the same thing.

**What it never does:** retry in a loop, show the key, or repeat a stale result as current. It
always shows when the result was checked.

## Tests (once the seam exists)

- **Kit:** MockFacade fixtures for `ok` / `auth_rejected` / `unreachable` / `not_configured` /
  `warn`. Check that the banner text, buttons and quiet-when-healthy behaviour match, and that
  the throttle on focus holds.
- **e2e:** a desktop backend whose saved leader has a wrong key, so the banner appears with the
  `maxim tunnel key show` fix. Fix it in Settings, Check again, and the banner goes away.
- **Release checklist, Tier B:** a stale key on startup shows the banner.

## Open questions for pymaxim

1. Extend `/api/probe` with `{"saved": …}`, or add a separate endpoint?
2. Cache window, and is it per lane?
3. For cloud: does "ok" mean the key is accepted by a real round-trip, or only by format? The
   current cloud probe reports `cloud_key_not_live_tested`.
4. Should the heartbeat include the result, so the health strip updates without polling?
