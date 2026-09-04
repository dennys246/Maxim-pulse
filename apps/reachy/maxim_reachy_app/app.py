"""The ReachyMiniApp bootstrap — thin glue over pymaxim (reachy_mini_app.md § bootstrap).

Everything hard lives behind pymaxim facades; this file only sequences them:

1. **Serve** the on-device UI bundle + facade API — pymaxim's
   ``console.server.build_app(ui_dist)`` — on the robot's LAN interface so the
   owner's phone/laptop reaches it from the Pollen dashboard link. (The
   Console's 127.0.0.1-only rule is about the *owner's machine*; the robot's
   page is inherently LAN-served, the same trust surface as Pollen's daemon —
   see the privacy posture, reachy_mini_app.md P3.) The console demands its
   bearer token (contract 0.4.0): ``device_console_handoff`` (pymaxim seam,
   hardening decision A9) mints/reuses it BEFORE the first request and names
   the origin the LAN page is reached by, which ``build_app`` must trust
   (the #609 Host/Origin guard). See ``main.py`` for what Pollen's dashboard
   can and cannot do with the sign-in link.
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

import socket
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


#: The name Pollen's wireless image advertises the robot under (mDNS/avahi).
MDNS_HOST = "reachy.local"


def _local_ipv4_addresses() -> list[str]:
    """The robot's own non-loopback IPv4 addresses, best effort, no deps.

    Browsers send the Host they navigated to, and the dashboard rewrites the
    ⚙️ link's hostname to whatever the dashboard itself was opened with (mDNS
    name or a bare IP) — an unlisted one is refused 400 fail-closed by the
    console's Host guard, so every name this page can be reached by must be
    admitted. Empty when nothing can be determined (a sandboxed test).
    """
    found: list[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))  # TEST-NET; nothing is sent
            found.append(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except (socket.gaierror, OSError):
        pass
    return [ip for i, ip in enumerate(found) if not ip.startswith("127.") and ip not in found[:i]]


@dataclass(frozen=True)
class BootstrapConfig:
    """Where to serve and which agent to build. All values have robot-sane defaults."""

    host: str = "0.0.0.0"  # LAN — the dashboard links a phone browser to this page
    port: int = 8765  # parity with the Console default (console.port)
    #: Names/addresses the page is reached by (Host header) — the console's
    #: Host/Origin guard admits exactly these. None = mDNS name + detected IPs.
    advertised_hosts: tuple[str, ...] | None = None
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

    #: The sign-in URL (carries the token in its FRAGMENT) — A7: never log it.
    handoff_url: str | None = None

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


def advertised_hosts(config: BootstrapConfig) -> tuple[str, ...]:
    return config.advertised_hosts or (MDNS_HOST, *_local_ipv4_addresses())


def _default_serve(config: BootstrapConfig) -> _Server:
    try:
        from maxim.console.server import (  # type: ignore[import-not-found]
            build_app,
            device_console_handoff,
        )
    except ImportError as error:
        raise MaximNotInstalledError() from error
    hosts = advertised_hosts(config)
    # 1. Mint/reuse ~/.config/maxim/console_token BEFORE the first request
    #    (build_app reads it from disk per request; --rotate-token still bites).
    handoff = device_console_handoff(host=hosts[0], port=config.port)
    # 2. Every name the LAN page is reached by must pass the Host/Origin guard.
    #    console.sandbox must be OFF on-device: build_app refuses the
    #    sandbox × extra_trusted_origins combination at build time (auth off).
    origins = [handoff.origin, *(f"http://{host}:{config.port}" for host in hosts[1:])]
    ui_dist = config.ui_dist if config.ui_dist.is_dir() else None
    app = build_app(ui_dist, ui_source="packaged", extra_trusted_origins=origins)
    server = _UvicornThread(app, config.host, config.port)
    server.handoff_url = handoff.url
    return server


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
    """One persistent embodied agent per app run; UI + facade served alongside.

    ``dont_start_webserver``: pymaxim serves the UI; the SDK must not start its
    own settings server on the same port. The dashboard-facing ``custom_app_url``
    literal lives in ``main.py`` (Pollen's daemon reads it from THAT file).
    """

    dont_start_webserver: bool = True

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
        # Best effort for an SDK that reads the instance: the signed-in ⚙️
        # link. Pollen's 1.8.x daemon does NOT (see main.py) — it renders the
        # literal from main.py, which lands on the paste screen. Never logged.
        handoff_url = getattr(server, "handoff_url", None)
        if handoff_url:
            self.custom_app_url = handoff_url
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
