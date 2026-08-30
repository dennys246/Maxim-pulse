# maxim-pulse

The **face of [Maxim](https://pymaxim.bio)** — a React + TypeScript monorepo producing two
build targets over a shared UI kit, both thin presentation over
[pymaxim](https://github.com/dennys246/Maxim)'s `api.py` / `maxim serve`:

- **Maxim Console** — a localhost dashboard (served by pymaxim's `maxim serve` on
  `127.0.0.1`) to configure, run, and observe Maxim.
- **Reachy app** — the same kit packaged as a Pollen `ReachyMiniApp` (Hugging Face
  Space), running on-device on a Reachy Mini. Flagship experience: **Adventure**.

Project home: **[pymaxim.bio](https://pymaxim.bio)** · Docs:
**[docs.pymaxim.bio](https://docs.pymaxim.bio)** (start with
[getting started](https://docs.pymaxim.bio/getting-started/)) · A hosted console is a
non-goal for now (`pulse.pymaxim.bio` is reserved if that ever changes — the console is
localhost-only).

## Layout

| Path           | What it is                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/kit` | Shared UI kit (Layer 2): components bind to pymaxim facades/seams via a `FacadeClient` generated from `maxim serve`'s OpenAPI contract |
| `apps/console` | Console shell (Layer 3)                                                                                                                |
| `apps/reachy`  | Reachy shell (Layer 3): lean on-device UI bundle (`ui/`) + thin Python `ReachyMiniApp` bootstrap                                       |

Heavy dashboard viz (`@maxim/kit/viz` — react-flow/visx) never enters the Reachy
on-device bundle; `pnpm size:reachy` enforces it.

## Develop

```bash
pnpm install
pnpm dev                              # Maxim Console → http://localhost:5173
pnpm --filter @maxim/reachy-ui dev    # Reachy UI

# Checks (CI runs the same)
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm build && pnpm size:reachy
```

Architecture and standards: [AGENTS.md](AGENTS.md) · workflow and checks:
[CLAUDE.md](CLAUDE.md) · plans: [docs/plans/](docs/plans/).

## Shipping the UI to Python (the dist handoff)

The bundles are built here but **served from Python** — `maxim serve` for the
Console, the `ReachyMiniApp` bootstrap on the robot. `dist/` is gitignored build
output, so for a shipped `pip install pymaxim && maxim serve` (no `--ui-dist`)
the bundle must be vendored into the wheel as package data:

```bash
pnpm build && pnpm dist:pack   # → artifacts/{console,reachy}-dist.tar.gz
```

Each archive's root **is** the dist root — extract straight into the target dir:

| Artifact              | Vendors into                           | Served by                                               |
| --------------------- | -------------------------------------- | ------------------------------------------------------- |
| `console-dist.tar.gz` | `src/maxim/console/ui_dist/` (pymaxim) | `maxim serve`, defaulting `console.ui_dist`             |
| `reachy-dist.tar.gz`  | `maxim_reachy_app/ui_dist/`            | the ReachyMiniApp bootstrap (already prefers this path) |

CI uploads both on every build and attaches them to the GitHub release when a
`v*` tag is pushed — vendor from a pinned tag, not from `main`.

**Contract stamp.** Every bundle carries `maxim-ui.json`, written by `pnpm build`
(not just when packaging — a bundle served straight from `dist/` via `--ui-dist`
must be verifiable too):

```json
{
  "target": "console",
  "app_version": "0.1.0",
  "contract_version": "0.3.0",
  "commit": "c6dfcc9",
  "commit_date": "2026-08-01T03:02:30Z",
  "describe": "v0.1.0-3-gc6dfcc9",
  "dirty": false
}
```

It exists so a consumer can answer three questions about a bundle it did not
build:

| Question                       | Field              | Why it is not something else                                                                                                                                                                                                                    |
| ------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Which bundle is this?**      | `describe`         | Tag-anchored, so two builds differ even when `app_version` has not moved. `app_version` alone was frozen at `0.0.1` and identified nothing.                                                                                                     |
| **Is it stale?**               | `commit_date`      | Orderable, so a vendored bundle can be compared against the source it should match. Deliberately the HEAD **committer** date, not a build timestamp — a build clock would make every rebuild differ and destroy byte-identical reproducibility. |
| **Does it match the backend?** | `contract_version` | The `maxim serve` contract its typed client was generated against — the one drift `gen:facade:check` cannot see, because it crosses the release boundary.                                                                                       |

`dirty` is its own boolean rather than a `-dirty` suffix on `commit`, so either
field can be parsed without string surgery. `pnpm dist:pack` refuses to package
a bundle missing any of these: once vendored into a wheel there is no way to ask
what it is after the fact.

**Durability.** `dist/` is gitignored here _and_ in pymaxim, so a build output
is not an artifact anyone can vendor from later. Pushing a `v*` tag is what
makes one durable: CI packs both bundles and publishes them as release assets
(creating the release if it does not exist), and every build additionally
uploads them as a workflow artifact for testing a vendor step before a tag
exists.

## License

[Apache-2.0](LICENSE)
