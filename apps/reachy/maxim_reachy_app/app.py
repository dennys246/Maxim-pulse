"""The ReachyMiniApp bootstrap — thin glue over pymaxim (reachy_mini_app.md § bootstrap).

Everything hard lives behind pymaxim facades; this file only sequences them:

1. **Serve** the on-device UI bundle + facade API — pymaxim's
   ``console.server.build_app(ui_dist)`` — on the robot's LAN interface so the
   owner's phone/laptop reaches it from the Pollen dashboard link. (The
   Console's 127.0.0.1-only rule is about the *owner's machine*; the robot's
   page is inherently LAN-served, the same trust surface as Pollen's daemon —
   see the privacy posture, reachy_mini_app.md P3.)
2. **Build the persistent embodied agent** iff config resolves a large-tier
   placement: ``MaximHandle(agent_id=..., body="bodies/reachy_mini")``. When
   config doesn't resolve, we still serve — the UI's SetupWizard writes config
   through the SETUP seam and the agent builds on the next start.
3. **Honor stop_event — the dashboard stop IS the session boundary.**
   ``handle.stop(consolidation="full")`` + server shutdown, in ``finally``.
   This line is load-bearing: if it silently no-ops, the cross-session
   "remembers you" thesis breaks (AGENTS.md § execution flows).

Dependencies are injectable so tests run fully offline (no pymaxim, no robot,
no sockets); the defaults import pymaxim lazily and fail with an install hint.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

try:
    from reachy_mini import ReachyMiniApp  # type: ignore[import-not-found]
except ImportError:  # SDK arrives via the `robot` extra; tests use fakes.

    class ReachyMiniApp:  # type: ignore[no-redef]
        """Stand-in base matching Pollen's ReachyMiniApp run() contract."""


class MaximNotInstalledError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "pymaxim is not installed — install this app with its robot extra: "
            "pip install 'maxim-reachy-app[robot]'"
        )


class _Server(Protocol):
    def stop(self) -> None: ...


@dataclass(frozen=True)
class BootstrapConfig:
    """Where to serve and which agent to build. All values have robot-sane defaults."""

    host: str = "0.0.0.0"  # LAN — the dashboard links a phone browser to this page
    port: int = 8765  # parity with the Console default (console.port)
    ui_dist: Path = field(
        # packaged bundle first; repo-layout fallback for development
        default_factory=lambda: (
            (Path(__file__).parent / "ui_dist")
            if (Path(__file__).parent / "ui_dist").is_dir()
            else Path(__file__).parent.parent / "ui" / "dist"
        )
    )
    agent_id: str = "reachy"
    body: str = "bodies/reachy_mini"


class _UvicornThread:
    """uvicorn in a daemon thread with a clean stop; default `serve` dependency."""

    def __init__(self, app: Any, host: str, port: int) -> None:
        import uvicorn

        self._server = uvicorn.Server(
            uvicorn.Config(app, host=host, port=port, log_level="warning")
        )
        self._thread = threading.Thread(
            target=self._server.run, daemon=True, name="maxim-reachy-ui"
        )
        self._thread.start()

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=10)


def _default_serve(config: BootstrapConfig) -> _Server:
    try:
        from maxim.console.server import build_app  # type: ignore[import-not-found]
    except ImportError as error:
        raise MaximNotInstalledError() from error
    ui_dist = config.ui_dist if config.ui_dist.is_dir() else None
    return _UvicornThread(build_app(ui_dist), config.host, config.port)


def _default_build_handle(config: BootstrapConfig) -> Any:
    try:
        from maxim.console.handle import MaximHandle  # type: ignore[import-not-found]
    except ImportError as error:
        raise MaximNotInstalledError() from error
    return MaximHandle(agent_id=config.agent_id, body=config.body)


def _default_placement_resolvable() -> bool:
    # Rides the existing config facade. Candidate pymaxim helper (flagged):
    # a single `placement_resolvable()` next to the SETUP seam would let this
    # app not know the config vocabulary at all.
    try:
        from maxim.runtime.config_loader import resolve_setting  # type: ignore[import-not-found]
    except ImportError as error:
        raise MaximNotInstalledError() from error

    def value(path: str) -> Any:
        result = resolve_setting(path)
        return result[0] if isinstance(result, tuple) else result

    if bool(value("cloud.enabled")):
        return True
    placement = value("lanes.large.placement")
    return placement is not None and str(placement) != ""


class MaximReachyApp(ReachyMiniApp):
    """One persistent embodied agent per app run; UI + facade served alongside."""

    def __init__(
        self,
        config: BootstrapConfig | None = None,
        *,
        serve: Callable[[BootstrapConfig], _Server] = _default_serve,
        build_handle: Callable[[BootstrapConfig], Any] = _default_build_handle,
        placement_resolvable: Callable[[], bool] = _default_placement_resolvable,
    ) -> None:
        self.config = config or BootstrapConfig()
        self._serve = serve
        self._build_handle = build_handle
        self._placement_resolvable = placement_resolvable

    def run(self, reachy_mini: Any, stop_event: threading.Event) -> None:
        server = self._serve(self.config)
        handle: Any | None = None
        try:
            if self._placement_resolvable():
                handle = self._build_handle(self.config)
            # else: setup-only serve — the wizard writes config via SETUP; the
            # dashboard start after setup builds the agent.
            stop_event.wait()
        finally:
            try:
                if handle is not None:
                    # THE session boundary. Full consolidation, never inferred
                    # from a proxy flag (HANDLE stop contract, pymaxim #427).
                    handle.stop(consolidation="full")
            finally:
                server.stop()
