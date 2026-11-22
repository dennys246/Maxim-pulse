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
   "remembers you" thesis breaks (AGENTS.md § execution flows). The whole
   stop fits inside Pollen's 20 s kill (``STOP_BUDGET_S``, pulse #67).

Dependencies are injectable so tests run fully offline (no pymaxim, no robot,
no sockets); the defaults import pymaxim lazily and fail with an install hint.
"""

from __future__ import annotations

import inspect
import logging
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


class ConsoleTokenUnusableError(RuntimeError):
    """The device's console token file exists but cannot be used (pymaxim >= 1.3.4, #1402).

    pymaxim refuses to overwrite it (that would silently log out every signed-in
    browser), so the console cannot start. This names what pymaxim found and how
    to fix it, in the daemon's app log, instead of a bare traceback. The token
    itself is never read, so it can never be in this message.
    """

    def __init__(self, error: Exception) -> None:
        reason = getattr(error, "reason", None) or str(error)
        path = getattr(error, "path", None)
        fix_hint = getattr(error, "fix_hint", None)
        message = f"the robot's console token file is unusable ({reason})"
        if path is not None:
            message += f": {path}"
        message += ". The console cannot start until it is fixed"
        message += f" — {str(fix_hint).rstrip('.')}" if fix_hint else ""
        super().__init__(message + ". Then restart the app.")


def _key_file_unusable() -> tuple[type[BaseException], ...]:
    """pymaxim's ``KeyFileUnusable``, or nothing to catch on 1.3.3 (which never raises it)."""
    try:
        from maxim.exceptions import KeyFileUnusable  # type: ignore[import-not-found]
    except ImportError:
        return ()
    return (KeyFileUnusable,)


logger = logging.getLogger(__name__)

# ── the stop budget (pulse #67) ──────────────────────────────────────────────
#
# Pollen's daemon stops an app with SIGINT, then kills its whole process tree
# 20 s later (reachy_mini 1.8.3 and 1.13 ``AppManager.stop_current_app``,
# ``timeout=20.0``, no caller overrides it). SIGINT unwinds ``run()``'s
# ``finally``, so everything there shares ONE budget, spent in order: the
# embodied agent, then the console server (whose lifespan stops the console's
# own agent), then the voice provisioner; the reserve is for what runs after
# (the player stop, ReachyMini's context exit, interpreter exit).
#
# Bounding the agent is safe only from pymaxim 1.3.4, which saves every store
# BEFORE consolidating and consolidates only within the caller's deadline
# (#1438): a short stop skips replay, never a save. 1.3.3 consolidates first,
# so on 1.3.3 the agent's stop stays unbounded (detected by feature).

#: Pollen's SIGINT → SIGKILL window.
DAEMON_KILL_S = 20.0
#: Kept back for the player stop, ReachyMini's context exit and interpreter exit.
EXIT_RESERVE_S = 3.0
#: The whole bootstrap stop, from the moment ``run()``'s ``finally`` starts.
STOP_BUDGET_S = DAEMON_KILL_S - EXIT_RESERVE_S
#: uvicorn's wait for open requests before the lifespan shutdown (an int, in s).
SERVER_GRACE_S = 1
#: The console lifespan's bounded stop of its own agent (``build_app(stop_budget_s=)``).
SERVER_STOP_BUDGET_S = 5.0
#: The server thread's join: grace + lifespan budget + pymaxim's report reserve.
SERVER_JOIN_S = SERVER_GRACE_S + SERVER_STOP_BUDGET_S + 1.0
#: The voice provisioner's join (it only downloads/loads the Piper voice).
VOICE_STOP_S = 1.0


def _deadline_type() -> Any | None:
    """pymaxim's ``Deadline`` (>= 1.3.4, with ``MaximHandle.stop(deadline=)``), else None (1.3.3)."""
    try:
        from maxim.utils.deadline import Deadline  # type: ignore[import-not-found]
    except ImportError:
        return None
    return Deadline


def _accepts(fn: Callable[..., Any], name: str) -> bool:
    try:
        return name in inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False


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
        self,
        app: Any,
        host: str,
        port: int,
        *,
        on_stop: Callable[[], None] | None = None,
        join_s: float = 10.0,
    ) -> None:
        import uvicorn

        self._on_stop = on_stop
        self._join_s = join_s
        # uvicorn waits for open requests before the lifespan shutdown, with no
        # limit by default: an in-flight Talk request would hold back the
        # console's own bounded stop (pymaxim's private _serve does the same).
        self._server = uvicorn.Server(
            uvicorn.Config(
                app,
                host=host,
                port=port,
                log_level="warning",
                timeout_graceful_shutdown=SERVER_GRACE_S,
            )
        )
        self._thread = threading.Thread(
            target=self._server.run, daemon=True, name="maxim-reachy-ui"
        )
        self._thread.start()

    def stop(self) -> None:
        try:
            self._server.should_exit = True
            self._thread.join(timeout=self._join_s)
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
    #    pymaxim >= 1.3.4 refuses a token file it cannot read rather than
    #    overwrite it (#1402); present that here, it is the owner's to fix.
    try:
        handoff = device_console_handoff(host=hosts[0], port=config.port)
    except _key_file_unusable() as error:
        raise ConsoleTokenUnusableError(error) from error
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
    # pymaxim >= 1.3.4: the console lifespan's stop fits its share of the budget.
    bounded = (
        {"stop_budget_s": SERVER_STOP_BUDGET_S} if _accepts(build_app, "stop_budget_s") else {}
    )
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
        **bounded,
    )
    server = _UvicornThread(
        app,
        config.host,
        config.port,
        on_stop=lambda: voice.stop(timeout_s=VOICE_STOP_S),
        # 1.3.3's lifespan drain is unbounded: keep its old 10 s join there.
        join_s=SERVER_JOIN_S if bounded else 10.0,
    )
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


def _device_player() -> tuple[Callable[[Any], Any] | None, Callable[[Any], Any] | None]:
    """pymaxim's speaker lifecycle (``start_device_player``/``stop_device_player``, 1.3.4+).

    (None, None) on pymaxim 1.3.3, or with no pymaxim at all, so the caller falls back
    to the SDK calls.
    """
    try:
        from maxim.utils.audio import (  # type: ignore[import-not-found]
            start_device_player,
            stop_device_player,
        )
    except ImportError:
        return None, None
    return start_device_player, stop_device_player


def _start_sdk_player(reachy_mini: Any) -> None:
    """The pymaxim 1.3.3 fallback, in pymaxim's order: wobbler off, THEN start the player.

    ``start_playing()`` would start an existing SDK wobbler; turning it off first means
    speech can never move the head. ``disable_wobbling()`` turns off both the SDK and
    the daemon-side wobbler.
    """
    disable = getattr(reachy_mini, "disable_wobbling", None)
    if disable is not None:
        disable()
    media = getattr(reachy_mini, "media", None)
    if media is not None:
        media.start_playing()


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

    def wrapped_run(self, *args: Any, **kwargs: Any) -> None:
        # The SDK's ReachyMini turns the body to follow the head by default; with
        # pymaxim's ReachyMiniController in charge of motion that is a second,
        # unasked-for mover (pymaxim #1499). wrapped_run forwards kwargs to
        # ReachyMini() (reachy_mini 1.8.3 and 1.13). pymaxim's reset on adopt is
        # only a backstop for this.
        kwargs.setdefault("automatic_body_yaw", False)
        super().wrapped_run(*args, **kwargs)

    def run(self, reachy_mini: Any, stop_event: threading.Event) -> None:
        # The robot's speaker player must be started before any audio is pushed, and
        # the head wobbler turned off FIRST, so speech never moves the head, not even
        # for a moment (pymaxim #1435, embodied_device.md §3). Stopped last, after
        # the server. This bootstrap is the interim lifecycle owner until pymaxim's
        # embody() takes it over.
        start_player, stop_player = _device_player()
        if start_player is not None:
            # pymaxim >= 1.3.4: its sink trusts only a start it recorded itself.
            # A False return is logged by pymaxim; the paste sign-in still works.
            start_player(reachy_mini)
        else:
            _start_sdk_player(reachy_mini)  # pymaxim 1.3.3
        try:
            self._serve_until_stopped(reachy_mini, stop_event)
        finally:
            if stop_player is not None:
                stop_player(reachy_mini)
            else:
                media = getattr(reachy_mini, "media", None)
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
            # The clock starts here: SIGINT is what unwinds the wait above.
            deadline_type = _deadline_type()
            stop_by = deadline_type.after(STOP_BUDGET_S) if deadline_type is not None else None
            try:
                if handle is not None:
                    # THE session boundary. Full consolidation, never inferred
                    # from a proxy flag (HANDLE stop contract, pymaxim #427).
                    self._stop_agent(handle, stop_by)
            finally:
                server.stop()

    @staticmethod
    def _stop_agent(handle: Any, stop_by: Any | None) -> None:
        if stop_by is None:  # pymaxim 1.3.3: no deadline, and it consolidates before saving
            handle.stop(consolidation="full")
            return
        # Everything after the agent keeps its share; the agent gets the rest.
        finished = handle.stop(
            consolidation="full",
            deadline=stop_by.ending_early(SERVER_JOIN_S + VOICE_STOP_S),
        )
        if finished is False:
            # Stores are saved first (pymaxim #1438), so this cost consolidation
            # steps only; pymaxim's session end names the ones it skipped.
            logger.warning(
                "the agent's stop did not finish within its %.0f s share of Pollen's %.0f s stop",
                max(0.0, STOP_BUDGET_S - SERVER_JOIN_S - VOICE_STOP_S),
                DAEMON_KILL_S,
            )
