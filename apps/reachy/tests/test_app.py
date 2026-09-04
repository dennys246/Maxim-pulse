"""Bootstrap tests — fully offline: fake SDK handle, fake server, fake pymaxim deps.

The load-bearing assertion (AGENTS.md § execution flows): every stop_event is a
clean FULL session-end — handle.stop(consolidation="full") fires, and the
server stops even if the handle is absent or stop raises.
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
        serve=lambda config: server,
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
        serve=lambda config: server,
        build_handle=lambda config: ExplodingHandle(),
        placement_resolvable=lambda: True,
    )
    stop = threading.Event()
    stop.set()
    with pytest.raises(RuntimeError, match="consolidation crashed"):
        app.run(FakeReachyMini(), stop)
    assert server.stopped


def test_default_deps_fail_loudly_without_pymaxim() -> None:
    # Default construction is valid; running without pymaxim installed must
    # raise the friendly install hint, not an opaque ImportError.
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
    calls: dict = {"handoff": [], "build_app": [], "uvicorn": []}

    def device_console_handoff(host: str, port: int = 8765) -> FakeHandoff:
        calls["handoff"].append({"host": host, "port": port})
        return FakeHandoff(f"http://{host}:{port}")

    def build_app(ui_dist, ui_source="none", *, extra_trusted_origins=()):
        calls["build_app"].append(
            {
                "ui_dist": ui_dist,
                "ui_source": ui_source,
                "extra_trusted_origins": list(extra_trusted_origins),
            }
        )
        return object()

    server_mod = types.ModuleType("maxim.console.server")
    server_mod.build_app = build_app  # type: ignore[attr-defined]
    server_mod.device_console_handoff = device_console_handoff  # type: ignore[attr-defined]
    console_pkg = types.ModuleType("maxim.console")
    maxim_pkg = types.ModuleType("maxim")
    for name, mod in (
        ("maxim", maxim_pkg),
        ("maxim.console", console_pkg),
        ("maxim.console.server", server_mod),
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
    server = _default_serve(config)
    # handoff BEFORE build/serve: the token must exist before the first request
    assert calls["handoff"] == [{"host": MDNS_HOST, "port": 8765}]
    assert calls["build_app"] == [
        {
            "ui_dist": tmp_path,
            "ui_source": "packaged",
            "extra_trusted_origins": ["http://reachy.local:8765", "http://192.168.1.42:8765"],
        }
    ]
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
