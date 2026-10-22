"""The installed app must carry its UI bundle.

On the robot the app is pip-installed from a checkout with the Reachy bundle
extracted into maxim_reachy_app/ui_dist/. This builds a REAL wheel from such a
checkout (no network: the local setuptools, no build isolation) and checks the
bundle is inside it, and that the installed default path finds it.
"""

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("setuptools")

APP = Path(__file__).resolve().parent.parent


def test_the_wheel_ships_ui_dist(tmp_path: Path) -> None:
    src = tmp_path / "app"
    shutil.copytree(APP, src, ignore=shutil.ignore_patterns("ui", "tests", "*.egg-info", "build"))
    bundle = src / "maxim_reachy_app" / "ui_dist"
    (bundle / "assets").mkdir(parents=True)
    (bundle / "index.html").write_text("<!doctype html>")
    (bundle / "maxim-ui.json").write_text("{}")
    (bundle / "assets" / "index-abc.js").write_text("")

    subprocess.run(
        [sys.executable, "-m", "pip", "wheel", "--no-deps", "--no-build-isolation", "-q"]
        + ["-w", str(tmp_path / "dist"), str(src)],
        check=True,
    )
    (wheel,) = (tmp_path / "dist").glob("maxim_reachy_app-*.whl")
    names = set(zipfile.ZipFile(wheel).namelist())
    for member in ("index.html", "maxim-ui.json", "assets/index-abc.js"):
        assert f"maxim_reachy_app/ui_dist/{member}" in names, member
    assert not any(n.startswith(("tests/", "ui/")) for n in names)
