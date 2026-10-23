# Pulse in the pymaxim 1.3.4 cycle

Status: **proposed** (owner direction 2026-10-23). Two tracks:

- **A:** bring pulse's testing and security standards up to pymaxim's.
- **B:** let the Console choose Maxim's chat tools, so Talk can use the internet.

Pymaxim 1.3.4 already plans #1428 (probe the saved connection: `connection_check.md`) and #1430
(Talk claims abilities it lacks); B depends on a third pymaxim seam described below.

Pulse ships this as **v0.5.x** after v0.4.3 (the Reachy voice + health release on 1.3.3).

---

## A. Testing and security standards, matched to pymaxim

pymaxim's gates, and where pulse stands (surveyed 2026-10-23):

| Standard | pymaxim | pulse today | Plan |
| --- | --- | --- | --- |
| Coverage ratchet | `lint_coverage.py` + `coverage_floors.json`: per-package `{percent, missing}` floors, measured in CI | not measured | **A1** |
| Diff coverage | ≥ 80% of changed executable lines, reviewed exclusion list | none | **A1** |
| Function-length pin | `lint_function_length.py` + baseline | none | **A2** |
| No silent swallows | `lint_no_silent_swallows.py` | 12 bare `catch {}` | **A3** |
| Secret scanning | `lint_secrets.py`: diff-scoped per PR, whole tree nightly, allowlist | none | **A4** |
| Code scanning | CodeQL (Python, JS, Actions) on every PR | none | **A5** |
| Dependencies | pinned extras, nightly extras matrix | lockfile only | **A6** |
| Workflow hardening | `permissions:` on every job | partial | **A7** |
| Repo settings as code | `check_repo_settings.py` nightly | none | **A8** |
| Nightly lanes | slow, extras, real libraries | e2e/acceptance on demand only | **A9** |
| Change discipline | CHANGELOG `[Unreleased]` required on source change; version sync | none | **A10** |

Each item is its own PR, red gate first where it is a gate, measured in **CI's own environment**
(never a laptop), so a floor is a fact about CI, as pymaxim's are.

### A1. Coverage ratchet (pymaxim's rules, applied to TypeScript and Python)

- **Measure:**
  - Vitest with `@vitest/coverage-v8` over `packages/kit` and both apps, statements and
    branches, emitting `coverage-summary.json`;
  - `pytest --cov` over `apps/reachy` and `scripts`.
- **Floors:** `scripts/coverage_floors.json`, one entry overall plus one per package (`kit/facade`,
  `kit/components`, `kit/shell`, `kit/design`, `console`, `reachy-ui`, `reachy-app`, `scripts`).
  Each floor is `{percent, missing}`, pinned from the first CI run and **rounded down to 0.1**.
- **`scripts/lint_coverage.mjs` enforces pymaxim's rules exactly:**
  - fail when measured is more than `k` statements under a floor, `k = max(ceil(statements ×
    0.001), 5)`, the CI-noise tolerance (non-cumulative, never moving a pin);
  - fail when measured is more than **1.0 pt over** a floor ("raise it in this PR");
  - a PR that changes a floor may not raise its `missing` (#1266 rule);
  - **diff coverage ≥ 80%** of the changed lines against the merge-base, minus a committed,
    reviewed `coverage_exclusions.json` where every entry has a reason (generated `schema.ts`,
    `contractVersion.ts`, entry `main.tsx`).
- **Wiring:** coverage runs inside the required `pnpm test` (one run, no second pass), and the gate
  reads its output.

### A2. Function-length pin

ESLint `max-lines-per-function` (bodies only, generous limit) plus a committed **baseline** of
today's long functions, each pinned at its current length. A pinned function may shrink (lower its
pin in the same PR); it may never grow, and a new function may never exceed the limit.

### A3. No silent swallows

Every `catch` must do something visible (report, rethrow, set state), or carry a
`// swallow: <why>` comment that a lint checks for. Today's 12 bare `catch {}` get reviewed:
most are "browser storage unavailable", which is legitimate but must say so.

### A4. Secret scanning

- **Per PR:** `scripts/lint_secrets.mjs` scans the diff for console tokens (`mxc_…`), API-key
  shapes (`sk-…`, long base64 near `key`/`token`), private keys and `.env` contents, with a
  committed allowlist (each entry with a reason; the e2e's `mxc_xxxx…` fixtures).
- **Nightly:** the same scan over the whole tree.
- **Repo:** GitHub secret scanning and push protection on (checked by A8).

### A5. CodeQL

`.github/workflows/codeql.yml`: JavaScript/TypeScript, Python and Actions, on every PR and
weekly, matching pymaxim.

### A6. Dependencies

- **Dependabot:** npm, pip (`apps/reachy`) and github-actions, weekly, grouped.
- **Per PR:** `pnpm audit --audit-level=high` and `pip-audit` (on the robot extra's resolution),
  failing on high or critical, with a reviewed ignore list (reason + expiry date).

### A7. Workflow hardening

- An explicit `permissions:` on every job (least privilege; only the tag publish job gets
  `contents: write`).
- Third-party actions pinned by commit SHA, with Dependabot keeping the pins fresh.
- Inputs passed via `env` only (already the rule).

### A8. Repo settings as code

`scripts/check_repo_settings.mjs`, nightly, compares GitHub's live settings with a committed
file and fails on drift:
- required status checks;
- signed commits required on `main`;
- no force-push;
- secret scanning and push protection.

### A9. Nightly lanes

A scheduled workflow:
- `scripts/e2e.sh` against the **newest PyPI pymaxim**;
- `release-acceptance.sh` desktop steps;
- the robot smoke on arm64;
- the whole-tree secret scan;
- the repo-settings check.

This catches pymaxim drifting under pulse between releases, not only on release day.

### A10. Change discipline

- **`CHANGELOG.md`** with an `[Unreleased]` section. A lint requires an entry when anything under
  `packages/` or `apps/` changes.
- **Version sync:** the app and kit `package.json` versions, the app pyproject and the CHANGELOG
  header agree when a tag is cut.

**Order:** A5, A7 and A4 first (cheap, and they close real risk); then A1 (the largest: measure,
pin, gate); then A2, A3, A6, A10, then A8 and A9.

---

## B. Choosing Maxim's tools in the Console (internet access)

### Today

A Talk turn may use only `respond`, `speak`, `read_file`, `glob` and `sense_tools`. That's a
hard-coded allow-list in pymaxim's `console/handle.py` (`TALK_CONVERSATIONAL_TOOLS`), and every
other tool is forbidden. So "what's in the news today?" can only ever be answered with "I can't".

pymaxim already has the internet tools:
- `internet_search`, with `requires_internet_access = True`; it needs the `search` extra (`ddgs`)
  for real results;
- `http_fetch`, with SSRF guards and `robots.txt` respected (failing closed).

There is no API to list tools or change the Talk toolset.

### What the owner wants

In the Console, choose which tools Maxim may use in chat, so it can properly access the internet.

### Who owns what

| Piece | Owner |
| --- | --- |
| the tool catalogue and each tool's effect (read / network / mutate) | pymaxim (the tools declare it) |
| **which tools may ever be enabled for Talk** (the safety boundary) | pymaxim, enforced server-side |
| persisting the choice (config) and applying it to the next turn without a restart | pymaxim |
| telling the model the actual toolset (one fix with #1430) | pymaxim |
| the toggles, explanations, unavailable states, the "used the web" indicator | pulse |

### The pymaxim seam: the MCP tool format (owner: "industry-standard formatting")

Tool descriptions follow the **Model Context Protocol (MCP)** tool schema, the shape `tools/list`
returns. It's the de facto standard: inputs are **JSON Schema** (as in OpenAI function calling
and Anthropic tool use), and behaviour is described by MCP's standard **annotations**. pymaxim's
own fields go in MCP's reserved extension field `_meta`, under a namespaced key, so the metadata
can grow without forking the format (owner: "we can expand the metadata if needed").

`GET /api/tools?mode=talk` returns `{ "tools": [Tool…], "nextCursor": null }`, where each `Tool`
is:

```jsonc
{
  // ── MCP Tool (standard) ──
  "name": "internet_search",
  "title": "Search the web",
  "description": "Search the internet (DuckDuckGo) for current information.",
  "inputSchema": {                        // JSON Schema (draft 2020-12)
    "type": "object",
    "properties": { "query": { "type": "string", "description": "What to search for" } },
    "required": ["query"]
  },
  "annotations": {                        // MCP ToolAnnotations
    "readOnlyHint": true,                 // changes nothing
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": true                 // reaches the outside world (the internet)
  },
  // ── pymaxim extension (MCP's reserved _meta, namespaced) ──
  "_meta": {
    "bio.pymaxim/talk": {
      "enabled": false,                   // in Talk, now
      "allowed": true,                    // may it be enabled for Talk at all?
      "lockedReason": null,               // why not, when allowed is false
      "available": false,                 // can it run in this install?
      "unavailableReason": "needs the search extra",
      "fix": "pip install 'pymaxim[search]'",
      "privacy": "Searches are sent to DuckDuckGo."
    }
  }
}
```

**How the old effect idea maps to the standard annotations:**

| Effect | `readOnlyHint` | `openWorldHint` | `destructiveHint` |
| --- | --- | --- | --- |
| reads local things | true | false | false |
| **uses the internet** | true | **true** | false |
| changes things | false | either | as applicable |

MCP defines annotations as *hints*, untrusted when they come from someone else's server.
pymaxim's are its own declarations about its own tools, and the boundary below is enforced on the
server **independently of them**: pulse only *displays* annotations, never uses them to decide
what's safe.

`POST /api/setup/talk-tools {"enable": ["internet_search", "http_fetch"]}`:
- persists the choice (e.g. `console.talk_tools` in `config.json`);
- **refuses any tool that isn't read-only for Talk** with a 409 and its reason; the boundary is
  enforced on the server, not by the UI;
- applies the choice to the next turn without a restart (cf. #1411);
- rebuilds the Talk prompt's tool list, so the model knows exactly what it can do (#1430);
- echoes the updated list in the same format.

Plus a seam name (e.g. `talk_tools`), so an older server shows the current fixed set read-only.

**Why this format:**
- **One format** for listing, for the model prompt and, later, for **interoperability**:
  pymaxim could expose its tools to other MCP clients, or bring MCP servers' tools into
  Maxim, without a second schema.
- **Extensible by spec:** new pymaxim metadata (cost, rate limits, required extras, per-mode
  policy) goes under `_meta["bio.pymaxim/…"]` without breaking MCP-aware readers.
- **Typed for free:** the shape lands in `openapi.json`, and pulse regenerates its client from
  it as it does for every other seam.

### What pulse renders

**Settings → "What Maxim can do in chat":**
- **one row per tool:** `title`, `description`, a badge derived from the annotations
  ("reads files" for `readOnlyHint`; "**uses the internet**" for `openWorldHint`; "changes
  things" when not read-only), the `privacy` line, and a toggle;
- **locked tools:** greyed, with the server's `lockedReason`; tools that change things stay off;
- **unavailable tools:** greyed, with `unavailableReason` and the `fix` as a **Cmd** (the
  violet command style).

**In the chat:** a reply that used the web shows a small "🌐 searched the web" or "🌐 read
example.com" line from the turn's actions (the response already lists them). You can see where an
answer came from.

**Tests:**
- MockFacade fixtures for each state;
- e2e: enable search, ask for news, see the 🌐 line (needs a live LLM, so Tier B);
- release-checklist items.

### Security notes, for the owner's decision

- **Prompt injection:** web pages can carry instructions aimed at the model. With only read
  tools enabled the blast radius is small (no file writes, no shell), but fetched content should
  reach the model marked as untrusted. That's pymaxim's, and worth a line in the seam's design.
- **Privacy:** searches leave the machine (DuckDuckGo) and fetches reach third-party sites. The
  toggle's description should say so plainly.
- **Default:** **off**. The owner turns it on deliberately; pulse never enables it for you.

### Open questions for the owner and pymaxim

1. Is search + fetch the right first set, or also `read_file` scoping and others?
2. Which MCP spec revision to pin (the annotations arrived in 2025-03-26), and the `_meta` key
   namespace (`bio.pymaxim/…`, a reverse-DNS form of pymaxim.bio, follows MCP's convention).
3. One switch per install, or per conversation?
4. Should the `search` extra join the `console` extra, so web search works from a plain
   `pymaxim[console]`, or stay opt-in with the fix shown?

---

## Sequencing

1. **Now (v0.4.3 window, after 1.3.3 is on PyPI):** the Reachy voice + health release; nothing from
   this plan blocks it.
2. **pulse v0.5.0:**
   - A5, A7 and A4 (CodeQL, workflow permissions, secret scanning);
   - then A1 (the coverage ratchet);
   - then A2, A3, A6 and A10.
3. **pulse v0.5.x, when pymaxim 1.3.4 lands the seams:**
   - the connection banner (#1428);
   - the tools settings (the new `talk_tools` seam, with #1430);
   - nightly lanes (A9) and repo settings (A8) once there's something to watch.
