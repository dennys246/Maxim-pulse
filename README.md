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

**Contract stamp.** Every bundle carries `maxim-ui.json`:

```json
{ "target": "console", "app_version": "0.0.1", "contract_version": "0.1.0", "commit": "abc1234" }
```

`contract_version` is the `info.version` of the `maxim serve` OpenAPI contract
the bundle's typed client was generated against. Serving a bundle whose
`contract_version` differs from the server's own is the one drift
`gen:facade:check` can't catch — it crosses the release boundary — so consumers
should read this file and warn on mismatch.

## License

[Apache-2.0](LICENSE)
