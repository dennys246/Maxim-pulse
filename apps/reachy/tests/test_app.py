"""Bootstrap tests — fully offline: fake SDK handle, fake server, fake pymaxim deps.

The load-bearing assertion (AGENTS.md § execution flows): every stop_event is a
clean FULL session-end — handle.stop(consolidation="full") fires, and the
server stops even if the handle is absent or stop raises.
"""

import threading

import pytest

from maxim_reachy_app import MaximReachyApp
from maxim_reachy_app.app import BootstrapConfig, MaximNotInstalledError


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
