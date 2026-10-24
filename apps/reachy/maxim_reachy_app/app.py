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


#: The name Pollen's wireless image advertises the robot under (mDNS/avahi): its
#: hostname, ``reachy-mini``, plus ``.local`` — observed on a real robot (2026-10-24);
#: ``reachy.local`` does not resolve. Used when the hostname can't be read.
MDNS_HOST = "reachy-mini.local"
#: An older name earlier docs used; still admitted, never relied on.
LEGACY_MDNS_HOST = "reachy.local"


def _local_mdns_names() -> list[str]:
    """The ``<hostname>.local`` name avahi advertises this robot under, then the legacy one.

    The robot's real name comes first: it's what ``device_console_handoff`` puts in the
    sign-in link, and what the dashboard is usually opened with.
    """
    try:
        short = socket.gethostname().split(".")[0].strip().lower()
    except OSError:
        short = ""
    own = f"{short}.local" if short and short != "localhost" else MDNS_HOST
    return list(dict.fromkeys([own, MDNS_HOST, LEGACY_MDNS_HOST]))


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

    def __init__(
        self, app: Any, host: str, port: int, *, on_stop: Callable[[], None] | None = None
    ) -> None:
        import uvicorn

        self._on_stop = on_stop
        self._server = uvicorn.Server(
            uvicorn.Config(app, host=host, port=port, log_level="warning")
        )
        self._thread = threading.Thread(
            target=self._server.run, daemon=True, name="maxim-reachy-ui"
        )
        self._thread.start()

    def stop(self) -> None:
        try:
            self._server.should_exit = True
            self._thread.join(timeout=10)
        finally:
            if self._on_stop is not None:
                self._on_stop()


def advertised_hosts(config: BootstrapConfig) -> tuple[str, ...]:
    return config.advertised_hosts or (*_local_mdns_names(), *_local_ipv4_addresses())


def _default_serve(config: BootstrapConfig, reachy_mini: Any) -> _Server:
    try:
        from maxim.console import make_pairing_announcer  # type: ignore[import-not-found]
        from maxim.console.server import (  # type: ignore[import-not-found]
            build_app,
            device_console_handoff,
        )
        from maxim.models.audio.tts import VoiceProvisioner  # type: ignore[import-not-found]
        from maxim.utils.audio import make_device_speak_sink  # type: ignore[import-not-found]
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
    # 3. The device sign-in path (A9.1): the robot SPEAKS a one-use code when
    #    the sign-in page asks. Pure wiring of pymaxim's pieces — the voice
    #    provisioner (downloads + verifies + loads the Piper voice in the
    #    background, retrying), the device sink (which owns the int16 → float32
    #    conversion the SDK needs) and the factory that composes them. Built
    #    here, before setup, because pairing is needed exactly when no agent
    #    exists yet — the owner signs in to RUN the setup wizard.
    #    `pairing_ready` is read per request: until the voice has spoken audible
    #    audio once (a robot that booted before Wi-Fi, or a voice that loads but
    #    cannot synthesize), the page offers only the paste path, and the by-ear
    #    path appears later with no restart — never "listen" to silence.
    voice = VoiceProvisioner()
    announcer = make_pairing_announcer(voice.engine, make_device_speak_sink(reachy_mini))
    ui_dist = config.ui_dist if config.ui_dist.is_dir() else None
    app = build_app(
        ui_dist,
        ui_source="packaged",
        extra_trusted_origins=origins,
        pairing_announcer=announcer,
        pairing_ready=voice.is_ready,
        # 4. Sample host health for the Logs → Health tab and the health strip
        #    (contract 0.6.0) — `maxim serve` does this by default; build_app
        #    does not.
        health_monitor=True,
    )
    server = _UvicornThread(app, config.host, config.port, on_stop=voice.stop)
    voice.start()  # only once the app exists: a failed build leaves no thread behind
    server.handoff_url = handoff.url
    return server


def _default_build_handle(config: BootstrapConfig) -> Any:
    try:
        from maxim.console.handle import MaximHandle  # type: ignore[import-not-found]
    except ImportError as error:
        raise MaximNotInstalledError() from error
    return MaximHandle(agent_id=config.agent_id, body=config.body)


def _default_placement_resolvable() -> bool:
    """Is an LLM configured for the agent? Only fields pymaxim's config schema defines.

    The SETUP seam writes a mesh leader as ``lanes.large.remote_url`` and a cloud key as
    ``cloud.*``; a local model is ``llm.profile``. (``lanes.large.placement`` was never a
    schema field: asking for it raises ConfigurationError, which took the app down on a
    real robot, 2026-10-24.) Candidate pymaxim helper (flagged): one
    ``placement_resolvable()`` next to the SETUP seam would spare this app the config
    vocabulary entirely.
    """
    try:
        from maxim.runtime.config_loader import resolve_setting  # type: ignore[import-not-found]
    except ImportError as error:
        raise MaximNotInstalledError() from error

    def value(path: str) -> Any:
        result = resolve_setting(path)
        return result[0] if isinstance(result, tuple) else result

    if not value("llm.enabled"):
        return False
    return (
        bool(value("cloud.enabled"))
        or bool(value("lanes.large.remote_url"))
        or bool(value("llm.profile"))
    )


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
        serve: Callable[[BootstrapConfig, Any], _Server] = _default_serve,
        build_handle: Callable[[BootstrapConfig], Any] = _default_build_handle,
        placement_resolvable: Callable[[], bool] = _default_placement_resolvable,
    ) -> None:
        # The SDK base sets up what wrapped_run() needs (stop_event, settings_app,
        # media_backend, the daemon-on-localhost probe); skipping it made the app
        # die on launch under the daemon. (The test stand-in base is plain object.)
        super().__init__()
        self.config = config or BootstrapConfig()
        self._serve = serve
        self._build_handle = build_handle
        self._placement_resolvable = placement_resolvable

    def run(self, reachy_mini: Any, stop_event: threading.Event) -> None:
        # Pollen's player must be started before any audio is pushed: before
        # start_playing(), push_audio_sample() logs "AppSrc is not initialized"
        # and DROPS the samples without raising, so the spoken pairing code was
        # silent on a real robot (2026-10-24). Every SDK app does this; it's
        # device glue, so it lives here. Stopped last, after the server.
        media = getattr(reachy_mini, "media", None)
        if media is not None:
            media.start_playing()
        # Speech never moves the head (pymaxim embodied_device.md §3, owner decision
        # 2026-10-24): the SDK's audio-reactive wobbler can be on daemon-side, and
        # disable_wobbling() turns it off on both the SDK and the daemon side. All
        # motion stays on goto_target. pymaxim's embody() takes this over later.
        disable = getattr(reachy_mini, "disable_wobbling", None)
        if disable is not None:
            disable()
        try:
            self._serve_until_stopped(reachy_mini, stop_event)
        finally:
            if media is not None:
                media.stop_playing()

    def _serve_until_stopped(self, reachy_mini: Any, stop_event: threading.Event) -> None:
        # the SDK handle feeds the pairing announcer's speaker
        server = self._serve(self.config, reachy_mini)
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
