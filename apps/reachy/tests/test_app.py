"""Bootstrap tests — fully offline: fake SDK handle, fake server, fake pymaxim deps.

The load-bearing assertion (AGENTS.md § execution flows): every stop_event is a
clean FULL session-end — handle.stop(consolidation="full") fires, and the
server stops even if the handle is absent or stop raises.

The pymaxim fakes here prove our WIRING, never pymaxim's behaviour: each one
mirrors the API we believe pymaxim has, so they all passed while pymaxim
1.3.2's TTS could not speak at all. Compatibility with a real release is
proven only by scripts/smoke-reachy-release.sh (CLAUDE.md § Required checks).
"""

import logging
import re
import sys
import threading
import types
from pathlib import Path

import pytest

from maxim_reachy_app import MaximReachyApp
from maxim_reachy_app.app import (
    MDNS_HOST,
    BootstrapConfig,
    MaximNotInstalledError,
    _default_serve,
    advertised_hosts,
)


class FakeReachyMini:
    """Stands in for the SDK handle; the bootstrap must not touch it."""


class FakeServer:
    def __init__(self) -> None:
        self.stopped = False

    def stop(self) -> None:
        self.stopped = True


class FakeHandle:
    def __init__(self) -> None:
        self.stop_calls: list[dict] = []

    def stop(self, *, consolidation: str) -> None:
        self.stop_calls.append({"consolidation": consolidation})


def make_app(
    *,
    resolvable: bool = True,
    server: FakeServer | None = None,
    handle: FakeHandle | None = None,
) -> tuple[MaximReachyApp, FakeServer, FakeHandle]:
    server = server or FakeServer()
    handle = handle or FakeHandle()
    app = MaximReachyApp(
        BootstrapConfig(),
        serve=lambda config, mini: server,
        build_handle=lambda config: handle,
        placement_resolvable=lambda: resolvable,
    )
    return app, server, handle


def run_to_completion(app: MaximReachyApp) -> None:
    stop = threading.Event()
    worker = threading.Thread(target=app.run, args=(FakeReachyMini(), stop))
    worker.start()
    stop.set()
    worker.join(timeout=5)
    assert not worker.is_alive()


def test_stop_event_triggers_full_consolidation_and_server_stop() -> None:
    app, server, handle = make_app(resolvable=True)
    run_to_completion(app)
    # THE regression guard: dashboard stop = session boundary = FULL consolidation.
    assert handle.stop_calls == [{"consolidation": "full"}]
    assert server.stopped


def test_unresolvable_config_serves_setup_only_and_builds_no_agent() -> None:
    app, server, handle = make_app(resolvable=False)
    run_to_completion(app)
    assert handle.stop_calls == []  # no agent was built, none stopped
    assert server.stopped  # but the setup UI was served + cleanly stopped


def test_server_stops_even_if_handle_stop_raises() -> None:
    class ExplodingHandle(FakeHandle):
        def stop(self, *, consolidation: str) -> None:
            raise RuntimeError("consolidation crashed")

    server = FakeServer()
    app = MaximReachyApp(
        BootstrapConfig(),
        serve=lambda config, mini: server,
        build_handle=lambda config: ExplodingHandle(),
        placement_resolvable=lambda: True,
    )
    stop = threading.Event()
    stop.set()
    with pytest.raises(RuntimeError, match="consolidation crashed"):
        app.run(FakeReachyMini(), stop)
    assert server.stopped


def test_default_deps_fail_loudly_without_pymaxim(monkeypatch: pytest.MonkeyPatch) -> None:
    # Default construction is valid; running without pymaxim installed must
    # raise the friendly install hint, not an opaque ImportError. "Not
    # installed" is simulated (a None entry makes every `maxim` import raise),
    # so the test means the same on a machine that does have pymaxim.
    monkeypatch.setitem(sys.modules, "maxim", None)
    app = MaximReachyApp()
    stop = threading.Event()
    stop.set()
    with pytest.raises(MaximNotInstalledError, match="maxim-reachy-app\\[robot\\]"):
        app.run(FakeReachyMini(), stop)


# ── the console token handoff (pymaxim seam A9; contract 0.4.0) ──────────────

TOKEN = "mxc_" + "t" * 43


class FakeHandoff:
    def __init__(self, origin: str) -> None:
        self.origin = origin
        self.url = f"{origin}/#token={TOKEN}"

    def __repr__(self) -> str:
        return f"ConsoleHandoff(url='{self.origin}/#token=<redacted>')"


def install_fake_pymaxim(monkeypatch: pytest.MonkeyPatch) -> dict:
    """A fake `maxim.console.server` + `uvicorn`: records what the bootstrap does."""
    calls: dict = {
        "handoff": [],
        "build_app": [],
        "uvicorn": [],
        "synth": [],
        "spoken": [],
        "voice": [],
    }

    def device_console_handoff(host: str, port: int = 8765) -> FakeHandoff:
        calls["handoff"].append({"host": host, "port": port})
        return FakeHandoff(f"http://{host}:{port}")

    def build_app(
        ui_dist,
        ui_source="none",
        *,
        extra_trusted_origins=(),
        pairing_announcer=None,
        pairing_ready=None,
        health_monitor=False,
    ):
        calls["build_app"].append(
            {
                "ui_dist": ui_dist,
                "ui_source": ui_source,
                "extra_trusted_origins": list(extra_trusted_origins),
                "pairing_announcer": pairing_announcer,
                "pairing_ready": pairing_ready,
                "health_monitor": health_monitor,
            }
        )
        if calls.get("build_app_raises"):
            raise RuntimeError("build_app refused")
        return object()

    # The three pymaxim pieces the bootstrap only WIRES (never composes itself).
    class TTSEngine:
        def synthesize(self, text: str) -> str:
            calls["synth"].append(text)
            return f"samples<{text}>"

    class VoiceProvisioner:
        """pymaxim's background voice download+verify+load; records its lifecycle."""

        def __init__(self) -> None:
            self.engine = TTSEngine()
            self.ready = False
            calls["voice"].append("init")

        def is_ready(self) -> bool:
            return self.ready

        def start(self) -> None:
            calls["voice"].append("start")

        def stop(self, timeout_s: float = 5.0) -> None:
            calls["voice"].append("stop")

    def make_device_speak_sink(mini):
        def speak(samples, sample_rate=16000):
            calls["spoken"].append({"mini": mini, "samples": samples})
            return True

        return speak

    def make_pairing_announcer(tts, speak):
        return lambda code: speak(tts.synthesize(f"code {code}"))

    server_mod = types.ModuleType("maxim.console.server")
    server_mod.build_app = build_app  # type: ignore[attr-defined]
    server_mod.device_console_handoff = device_console_handoff  # type: ignore[attr-defined]
    console_pkg = types.ModuleType("maxim.console")
    console_pkg.make_pairing_announcer = make_pairing_announcer  # type: ignore[attr-defined]
    tts_mod = types.ModuleType("maxim.models.audio.tts")
    tts_mod.VoiceProvisioner = VoiceProvisioner  # type: ignore[attr-defined]
    audio_mod = types.ModuleType("maxim.utils.audio")
    audio_mod.make_device_speak_sink = make_device_speak_sink  # type: ignore[attr-defined]
    maxim_pkg = types.ModuleType("maxim")
    for name, mod in (
        ("maxim", maxim_pkg),
        ("maxim.console", console_pkg),
        ("maxim.console.server", server_mod),
        ("maxim.models", types.ModuleType("maxim.models")),
        ("maxim.models.audio", types.ModuleType("maxim.models.audio")),
        ("maxim.models.audio.tts", tts_mod),
        ("maxim.utils", types.ModuleType("maxim.utils")),
        ("maxim.utils.audio", audio_mod),
    ):
        monkeypatch.setitem(sys.modules, name, mod)

    class FakeUvicornServer:
        def __init__(self, config) -> None:
            calls["uvicorn"].append({"host": config.host, "port": config.port})
            self.should_exit = False

        def run(self) -> None:
            pass

    uvicorn = types.ModuleType("uvicorn")
    uvicorn.Config = lambda app, host, port, log_level: types.SimpleNamespace(  # type: ignore
        host=host, port=port
    )
    uvicorn.Server = FakeUvicornServer  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "uvicorn", uvicorn)
    return calls


def test_default_serve_mints_the_token_first_and_admits_every_advertised_host(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = install_fake_pymaxim(monkeypatch)
    config = BootstrapConfig(advertised_hosts=(MDNS_HOST, "192.168.1.42"), ui_dist=tmp_path)
    server = _default_serve(config, FakeReachyMini())
    # handoff BEFORE build/serve: the token must exist before the first request
    assert calls["handoff"] == [{"host": MDNS_HOST, "port": 8765}]
    assert calls["build_app"] == [
        {
            "ui_dist": tmp_path,
            "ui_source": "packaged",
            "extra_trusted_origins": ["http://reachy.local:8765", "http://192.168.1.42:8765"],
            "pairing_announcer": calls["build_app"][0]["pairing_announcer"],
            "pairing_ready": calls["build_app"][0]["pairing_ready"],
            "health_monitor": True,  # the robot samples health (contract 0.6.0)
        }
    ]
    assert callable(calls["build_app"][0]["pairing_announcer"])
    assert calls["uvicorn"] == [{"host": "0.0.0.0", "port": 8765}]
    assert server.handoff_url == f"http://reachy.local:8765/#token={TOKEN}"
    server.stop()


def test_run_sets_the_signed_in_link_on_the_instance_without_logging_it(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class HandoffServer(FakeServer):
        handoff_url = f"http://reachy.local:8765/#token={TOKEN}"

    server = HandoffServer()
    app, _, _ = make_app(server=server, resolvable=False)
    with caplog.at_level(logging.DEBUG):
        run_to_completion(app)
    assert app.custom_app_url == server.handoff_url
    assert TOKEN not in caplog.text  # A7: the token never reaches a log line
    assert server.stopped


def test_advertised_hosts_default_to_mdns_plus_detected_ips() -> None:
    hosts = advertised_hosts(BootstrapConfig())
    assert hosts[0] == MDNS_HOST
    assert all(not host.startswith("127.") for host in hosts[1:])
    assert len(hosts) == len(set(hosts))


def test_dashboard_entry_point_carries_a_literal_the_daemon_regex_can_read() -> None:
    # Pollen's daemon (reachy_mini 1.8.3, apps/sources/local_common_venv.py)
    # reads custom_app_url by regex over <entry-point>/main.py at LISTING
    # time, never from a running instance; the dashboard then rewrites the
    # hostname. This pins the vendor contract the ⚙️ link depends on.
    from maxim_reachy_app import main

    source = Path(main.__file__).read_text(encoding="utf-8")
    pattern = r'custom_app_url\s*(?::\s*[^=]+)?\s*=\s*["\']([^"\']+)["\']'
    match = re.search(pattern, source)
    assert match is not None
    assert match.group(1) == main.MaximReachyApp.custom_app_url
    assert match.group(1).endswith(f":{BootstrapConfig().port}/")
    assert main.MaximReachyApp.dont_start_webserver is True  # pymaxim serves the UI
    assert MaximReachyApp.dont_start_webserver is True
    assert issubclass(main.MaximReachyApp, MaximReachyApp)


def test_the_pairing_announcer_speaks_through_the_robot_run_was_handed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # A9.1: the device sign-in path. The bootstrap only WIRES pymaxim's pieces
    # (TTS engine + device sink + factory); the sink must be bound to the SDK
    # handle Pollen passed into run(), and nothing may synthesize or touch audio
    # until a code is actually requested — construction stays inert.
    calls = install_fake_pymaxim(monkeypatch)
    robot = FakeReachyMini()
    server = _default_serve(BootstrapConfig(advertised_hosts=(MDNS_HOST,), ui_dist=tmp_path), robot)
    assert calls["synth"] == [] and calls["spoken"] == []  # inert at serve time

    calls["build_app"][0]["pairing_announcer"]("482913")
    assert calls["synth"] == ["code 482913"]
    assert calls["spoken"] == [{"mini": robot, "samples": "samples<code 482913>"}]
    server.stop()


def test_run_hands_the_sdk_handle_to_serve() -> None:
    seen: list = []
    server = FakeServer()
    app = MaximReachyApp(
        BootstrapConfig(),
        serve=lambda config, mini: seen.append(mini) or server,
        build_handle=lambda config: FakeHandle(),
        placement_resolvable=lambda: False,
    )
    robot = FakeReachyMini()
    stop = threading.Event()
    stop.set()
    app.run(robot, stop)
    assert seen == [robot]


def test_pairing_is_offered_only_once_the_voice_can_speak(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # The voice provisions in the background (a robot can boot before Wi-Fi).
    # build_app reads pairing_ready per request, so the by-ear path must follow
    # the provisioner LIVE: absent while it loads, present once it can speak.
    calls = install_fake_pymaxim(monkeypatch)
    server = _default_serve(
        BootstrapConfig(advertised_hosts=(MDNS_HOST,), ui_dist=tmp_path), FakeReachyMini()
    )
    ready = calls["build_app"][0]["pairing_ready"]
    voice = ready.__self__
    assert calls["voice"] == ["init", "start"]
    assert ready() is False
    voice.ready = True
    assert ready() is True
    server.stop()


def test_stopping_the_server_stops_the_voice_provisioner(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = install_fake_pymaxim(monkeypatch)
    server = _default_serve(
        BootstrapConfig(advertised_hosts=(MDNS_HOST,), ui_dist=tmp_path), FakeReachyMini()
    )
    server.stop()
    assert calls["voice"] == ["init", "start", "stop"]


def test_a_refused_build_leaves_no_provisioner_thread_behind(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = install_fake_pymaxim(monkeypatch)
    calls["build_app_raises"] = True
    with pytest.raises(RuntimeError, match="build_app refused"):
        _default_serve(
            BootstrapConfig(advertised_hosts=(MDNS_HOST,), ui_dist=tmp_path), FakeReachyMini()
        )
    assert calls["voice"] == ["init"]  # constructed, never started
    assert calls["uvicorn"] == []
