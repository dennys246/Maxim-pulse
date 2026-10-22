"""Release smoke: the REAL Reachy bootstrap against a REAL, published pymaxim.

Unit tests in apps/reachy fake every pymaxim piece, so they prove our wiring
matches OUR idea of pymaxim's API, never pymaxim's actual behaviour. This
script fakes exactly one thing, the robot (a stand-in SDK handle whose
speaker records what it is handed), and drives everything else for real:
pymaxim's console server, its voice provisioner (a real download + sha256
verify + load into a temp home), its TTS, its device speak sink.

It is the gate for any change to the robot extra's pymaxim pin
(CLAUDE.md § Required checks). Run it through scripts/smoke-reachy-release.sh,
which builds the throwaway venv and home; running it directly would write to
the real ~/.maxim.

Checks, in order (each prints PASS/FAIL; any FAIL exits 1):
  1. the bundle's maxim-ui.json stamp matches the installed server's contract
  2. pairing is NOT offered before the voice can speak, and IS offered once
     provisioning finishes (no restart)
  3. /api/health reports the server is sampling (health_monitor wired)
  4. a pairing request makes the robot's speaker receive real audio:
     float32 (the SDK's format), finite, at least ~1 s long, not silent
  5. stopping the server returns promptly

Never prints the console token or the spoken code (A7).
"""

from __future__ import annotations

import argparse
import json
import logging
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

#: The SDK's playback rate for push_audio_sample (the device sink resamples to it).
SDK_RATE = 16_000

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> bool:
    print(
        f"{'PASS' if ok else 'FAIL'}  {label}{f' — {detail}' if detail else ''}",
        flush=True,
    )
    if not ok:
        failures.append(label)
    return ok


class _RecordingMedia:
    def __init__(self) -> None:
        self.samples: list = []
        self.event = threading.Event()

    def push_audio_sample(self, samples) -> None:  # the SDK call the device sink makes
        self.samples.append(samples)
        self.event.set()


class FakeReachyMini:
    """The ONE fake: a robot whose speaker records instead of playing."""

    def __init__(self) -> None:
        self.media = _RecordingMedia()


class _Announcer(logging.Handler):
    """Surface pymaxim's type-only announcer failures, which otherwise vanish on a daemon thread."""

    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(f"{record.name}: {record.getMessage()}")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _get(base: str, path: str, token: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    with urllib.request.urlopen(
        urllib.request.Request(base + path, headers=headers), timeout=10
    ) as r:
        return json.load(r)


def _post_status(base: str, path: str) -> int:
    req = urllib.request.Request(
        base + path,
        data=b"{}",
        headers={"Content-Type": "application/json", "Origin": base},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as error:
        return error.code


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--reachy-app",
        type=Path,
        help="apps/reachy (the bootstrap package root); omit with --installed",
    )
    parser.add_argument(
        "--ui-dist",
        type=Path,
        help="the built Reachy bundle (apps/reachy/ui/dist); omit with --installed",
    )
    parser.add_argument(
        "--installed",
        action="store_true",
        help="smoke the PIP-INSTALLED app exactly as the robot runs it: its own default"
        " bundle path, and the real Pollen SDK must import",
    )
    parser.add_argument(
        "--voice-timeout",
        type=float,
        default=300.0,
        help="seconds to wait for the voice to load",
    )
    args = parser.parse_args()
    if not args.installed and (args.reachy_app is None or args.ui_dist is None):
        parser.error("--reachy-app and --ui-dist are required unless --installed")

    if not args.installed:
        sys.path.insert(0, str(args.reachy_app.resolve()))
    from importlib.metadata import version

    from maxim.console.ui_bundle import CONSOLE_CONTRACT_VERSION
    from maxim_reachy_app.app import BootstrapConfig, ReachyMiniApp, _default_serve

    print(
        f"pymaxim {version('pymaxim')} (console contract {CONSOLE_CONTRACT_VERSION})",
        flush=True,
    )
    announcer_log = _Announcer()
    logging.getLogger("maxim").addHandler(announcer_log)

    ui_dist = BootstrapConfig().ui_dist if args.installed else args.ui_dist
    if args.installed:
        # 0. the installed app is the real thing: its bundle shipped, the SDK is Pollen's
        check(
            ui_dist.is_dir() and "site-packages" in str(ui_dist),
            "the installed app ships its own UI bundle",
            str(ui_dist),
        )
        check(
            ReachyMiniApp.__module__.startswith("reachy_mini"),
            "the app subclasses the real Pollen ReachyMiniApp",
            f"{ReachyMiniApp.__module__}.{ReachyMiniApp.__qualname__}",
        )

    # 1. the bundle the robot serves was built for this server
    stamp_path = ui_dist / "maxim-ui.json"
    stamp = json.loads(stamp_path.read_text()) if stamp_path.is_file() else {}
    check(
        stamp.get("target") == "reachy"
        and stamp.get("contract_version") == CONSOLE_CONTRACT_VERSION,
        "bundle stamp matches the server contract",
        f"bundle {stamp.get('target')}@{stamp.get('contract_version')}, server {CONSOLE_CONTRACT_VERSION}",
    )

    robot = FakeReachyMini()
    port = _free_port()
    base = f"http://127.0.0.1:{port}"
    config = BootstrapConfig(
        host="127.0.0.1",
        port=port,
        advertised_hosts=("127.0.0.1",),
        ui_dist=ui_dist,
    )
    server = _default_serve(config, robot)
    try:
        deadline = time.monotonic() + 15
        while True:
            try:
                first = _get(base, "/api/hello")["pairing"]
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.2)
        # 2. never offer "listen" before the voice can speak; offer it once it can.
        #    The home is fresh, so no voice exists yet at the first request: a
        #    bootstrap that already says "available" is promising a silent robot.
        check(
            first == "none",
            "pairing is not offered before the voice is ready",
            f"first {first!r}",
        )
        start = time.monotonic()
        pairing = first
        while pairing != "available" and time.monotonic() - start < args.voice_timeout:
            time.sleep(1)
            pairing = _get(base, "/api/hello")["pairing"]
        check(
            pairing == "available",
            "pairing is offered once the voice is ready, without a restart",
            f"{pairing!r} after {time.monotonic() - start:.0f}s",
        )

        # 3. the robot samples its own health
        token = (getattr(server, "handoff_url", None) or "").partition("#token=")[2]
        try:  # a pre-0.6.0 server has no /api/health: that is a FAIL, not a crash
            health, health_detail = _get(base, "/api/health", token), ""
        except urllib.error.HTTPError as error:
            health, health_detail = {}, f"HTTP {error.code}"
        check(
            health.get("monitoring") is True,
            "the server samples health (health_monitor wired)",
            health_detail,
        )

        # 4. a pairing request reaches the robot's speaker as real audio
        status = _post_status(base, "/api/pair/request")
        check(status == 202, "a pairing request is accepted", f"HTTP {status}")
        robot.media.event.wait(90)
        if not robot.media.samples:
            check(
                False,
                "the robot's speaker receives the spoken code",
                "no audio was pushed",
            )
        else:
            import numpy as np

            audio = np.concatenate([np.asarray(s).ravel() for s in robot.media.samples])
            seconds = audio.size / SDK_RATE
            peak = float(np.abs(audio).max()) if audio.size else 0.0
            check(
                audio.dtype == np.float32
                and bool(np.isfinite(audio).all())
                and seconds >= 1.0
                and peak > 0.01,
                "the robot's speaker receives the spoken code",
                f"{audio.dtype}, {seconds:.1f}s at {SDK_RATE} Hz, peak {peak:.3f}",
            )
    finally:
        # 5. a clean stop (the dashboard stop is the session boundary)
        t = time.monotonic()
        server.stop()
        check(
            time.monotonic() - t < 15,
            "the server stops promptly",
            f"{time.monotonic() - t:.1f}s",
        )

    for line in announcer_log.lines:
        print(f"      pymaxim warned: {line}", flush=True)
    if (
        sys.platform == "darwin"
        and "the robot's speaker receives the spoken code" in failures
    ):
        print(
            "      note: piper-tts's macOS arm64 wheel cannot find its bundled espeak data; "
            "trust this check on Linux (CI) only.",
            flush=True,
        )
    print(
        "SMOKE FAILED: " + "; ".join(failures) if failures else "SMOKE PASSED",
        flush=True,
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
