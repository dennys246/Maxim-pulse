# maxim-pulse

The **face of [Maxim](https://pymaxim.bio)** — a React + TypeScript monorepo producing two
build targets over a shared UI kit, both thin presentation over
[pymaxim](https://github.com/dennys246/Maxim)'s `api.py` / `maxim serve`:

- **Maxim Console** — a localhost dashboard (served by pymaxim's `maxim serve` on
  `127.0.0.1`) to configure, run, and observe Maxim.
- **Reachy app** — the same kit packaged as a Pollen `ReachyMiniApp` (Hugging Face
  Space), running on-device on a Reachy Mini. Flagship experience: **Adventure**.

Project home: **[pymaxim.bio](https://pymaxim.bio)** · Docs:
**docs.pymaxim.bio** (coming online) · A hosted console is a non-goal for now
(`pulse.pymaxim.bio` is reserved if that ever changes — the console is localhost-only).

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

## License

[Apache-2.0](LICENSE)
