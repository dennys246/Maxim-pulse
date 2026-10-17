"""A DEVICE-shaped console for the e2e suite: what the Reachy bootstrap serves, minus the robot.

    python e2e/device_server.py <reachy ui dist> <port> <spoken-code file>

Mints the token and trusted origin with pymaxim's ``device_console_handoff``
exactly as the bootstrap does, then ``build_app`` with a STUB pairing
announcer that writes the "spoken" code to a file. That file is the test
harness standing in for the owner's ears, never something the product does.
Health sampling is on when this pymaxim supports it (0.6.0+), as on the robot.
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

import uvicorn
from maxim.console.server import build_app, device_console_handoff


def main() -> None:
    dist, port, spoken = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
    spoken.unlink(missing_ok=True)

    def announcer(code: str) -> None:
        spoken.write_text(code, encoding="utf-8")

    handoff = device_console_handoff(host="127.0.0.1", port=port)
    kwargs = {"extra_trusted_origins": [handoff.origin], "pairing_announcer": announcer}
    if "health_monitor" in inspect.signature(build_app).parameters:
        kwargs["health_monitor"] = True
    app = build_app(dist, ui_source="packaged", **kwargs)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
