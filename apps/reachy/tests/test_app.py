"""Phase-0 stub tests — fake SDK only; never a real ReachyMini() (blocks without hardware)."""

import threading

from maxim_reachy_app import MaximReachyApp


class FakeReachyMini:
    """Stands in for the SDK handle; the stub must not touch it."""


def test_run_returns_when_stop_event_set() -> None:
    app = MaximReachyApp()
    stop = threading.Event()
    stop.set()
    app.run(FakeReachyMini(), stop)  # returns immediately — clean stop path


def test_run_honors_stop_event_from_another_thread() -> None:
    app = MaximReachyApp()
    stop = threading.Event()
    worker = threading.Thread(target=app.run, args=(FakeReachyMini(), stop))
    worker.start()
    stop.set()
    worker.join(timeout=5)
    assert not worker.is_alive()
