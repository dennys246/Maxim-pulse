"""The ReachyMiniApp bootstrap — Phase-0 stub.

The real bootstrap (Phase 2, docs/plans/reachy_mini_app.md § "The app bootstrap")
will:
  1. Ensure config is resolvable; if not, serve the setup page and return.
  2. Build the persistent embodied agent via pymaxim's HANDLE seam.
  3. Serve the built UI bundle (apps/reachy/ui/dist) + enter the live loop.
  4. On stop_event: FULL session-end consolidation + save_cerebellum() —
     the dashboard stop IS the session boundary; this path is load-bearing.

Phase 0 proves only the shape: a ReachyMiniApp-compatible class that honors
stop_event, testable against a fake SDK (the real ReachyMini() blocks without
hardware; no test may touch it — CLAUDE.md).
"""

from __future__ import annotations

import threading
from typing import Any

try:
    from reachy_mini import ReachyMiniApp  # type: ignore[import-not-found]
except ImportError:  # Phase 0: the SDK dep lands with the Phase-2 bootstrap pin.

    class ReachyMiniApp:  # type: ignore[no-redef]
        """Stand-in base matching Pollen's ReachyMiniApp run() contract."""


class MaximReachyApp(ReachyMiniApp):
    def run(self, reachy_mini: Any, stop_event: threading.Event) -> None:
        # Phase-2: build embodied HANDLE, serve ui/dist, run the loop.
        stop_event.wait()
        # Phase-2: full session-end consolidation + save_cerebellum() here.
