"""The class Pollen's daemon loads — the `reachy_mini_apps` entry point.

Why a separate ``main.py`` with a string LITERAL, and not the bootstrap in
``app.py`` assigning ``custom_app_url`` at runtime (verified against
reachy_mini 1.8.3, ``apps/sources/local_common_venv.py`` + the dashboard's
``apps.js``):

* The daemon reads ``custom_app_url`` when it LISTS apps, never from a running
  instance. On the wireless robot (and the desktop app daemon) it regex-scans
  ``<entry-point-name>/main.py`` for the FIRST ``custom_app_url`` string
  literal — so the value must be a literal, in this file, under this name, and
  nothing above it may look like one (the test pins the daemon's regex against
  this file's source). In the shared-venv case it
  imports the entry point and reads the CLASS attribute instead.
* The dashboard rewrites the link's hostname to whatever the dashboard itself
  was opened with (``reachy.local`` or a bare IP) and keeps port, path and
  fragment. That is why ``app.py`` admits every such host to the console's
  Host/Origin guard.

Consequence for sign-in: this link cannot carry a token minted at runtime, so
on-device the ⚙️ link lands on the console's paste screen. ``app.py`` still
sets the tokened handoff URL on the instance for any SDK that reads it. The
sign-in token itself comes from ``maxim serve --show-token`` on the robot (or
the pymaxim-side decision that supersedes this note).
"""

from __future__ import annotations

from maxim_reachy_app.app import MaximReachyApp as _Bootstrap


class MaximReachyApp(_Bootstrap):
    """Dashboard-facing entry point; behaviour lives in ``app.py``."""

    # Read by the daemon's regex from THIS file. The hostname is a placeholder
    # (the dashboard substitutes its own); the port matches BootstrapConfig.
    custom_app_url: str | None = "http://0.0.0.0:8765/"
    dont_start_webserver: bool = True
