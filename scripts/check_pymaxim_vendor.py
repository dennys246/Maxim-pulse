"""Did a published pymaxim wheel vendor the console bundle it should have?

    python3 scripts/check_pymaxim_vendor.py 1.3.2
    python3 scripts/check_pymaxim_vendor.py --wheel dist/pymaxim-1.3.3-py3-none-any.whl

(--wheel checks a candidate before it is uploaded: "existed at upload" means now.)

pymaxim ships the Console by vendoring a pulse release bundle into its wheel.
Nothing on either side used to check WHICH bundle went in: pymaxim 1.3.2
vendored v0.4.0 when v0.4.1 (the stall-line fix for that very release) had been
tagged two days earlier. This reads the wheel from PyPI and compares its
vendored maxim-ui.json against pulse's own tags:

  PASS when the vendored bundle is the NEWEST pulse tag that existed when the
  wheel was uploaded and was built for the wheel's console contract, its stamp
  matches the server's contract, and it was built from a clean tree.

"Newest" is the highest STABLE semver tag (vMAJOR.MINOR.PATCH). Pre-release
tags (v0.5.0-rc.1) are never what a release should vendor, and tag creation
order is not version order (a v0.4.2 hotfix can be tagged after v0.5.0).

Run it after every pymaxim release (CLAUDE.md § Versioning). Stdlib only; needs
pulse's tags locally (`git fetch --tags`) and network access to PyPI.
"""

from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import time
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STAMP = "maxim/console/ui_dist/maxim-ui.json"
BUNDLE_MODULE = "maxim/console/ui_bundle.py"


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True
    ).stdout


def _wheel(version: str) -> tuple[zipfile.ZipFile, float]:
    with urllib.request.urlopen(
        f"https://pypi.org/pypi/pymaxim/{version}/json", timeout=30
    ) as r:
        meta = json.load(r)
    wheel = next(u for u in meta["urls"] if u["packagetype"] == "bdist_wheel")
    uploaded = datetime.fromisoformat(wheel["upload_time_iso_8601"]).timestamp()
    with urllib.request.urlopen(wheel["url"], timeout=120) as r:
        return zipfile.ZipFile(io.BytesIO(r.read())), uploaded


STABLE_TAG = re.compile(r"v(\d+)\.(\d+)\.(\d+)")


def stable_version(tag: str) -> tuple[int, int, int] | None:
    """(major, minor, patch) for a stable release tag; None for pre-releases and anything else."""
    m = STABLE_TAG.fullmatch(tag)
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def newest_for_contract(
    tags: list[tuple[str, float, str | None]], uploaded: float, contract: str | None
) -> str | None:
    """The highest stable tag created by `uploaded` whose contract is `contract`.

    `tags` is (tag, created_at, contract) per pulse tag.
    """
    eligible = [
        (version, tag)
        for tag, created, tag_contract in tags
        if (version := stable_version(tag)) is not None
        and created <= uploaded
        and tag_contract == contract
    ]
    return max(eligible)[1] if eligible else None


def _tag_contract(tag: str) -> str | None:
    try:
        return json.loads(_git("show", f"{tag}:packages/kit/openapi.json"))["info"][
            "version"
        ]
    except (subprocess.CalledProcessError, KeyError, json.JSONDecodeError):
        return None


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--wheel":
        version = Path(sys.argv[2]).name
        wheel, uploaded, label = zipfile.ZipFile(sys.argv[2]), time.time(), "checked"
    elif len(sys.argv) == 2 and not sys.argv[1].startswith("-"):
        version = sys.argv[1]
        wheel, uploaded = _wheel(version)
        label = "uploaded"
    else:
        print(__doc__)
        return 2
    names = set(wheel.namelist())
    if STAMP not in names:
        print(f"FAIL  pymaxim {version} vendors no console bundle ({STAMP} missing)")
        return 1
    stamp = json.loads(wheel.read(STAMP))
    match = re.search(
        r'CONSOLE_CONTRACT_VERSION\s*=\s*"([^"]+)"', wheel.read(BUNDLE_MODULE).decode()
    )
    server = match.group(1) if match else None

    tags = []
    for line in _git(
        "for-each-ref", "refs/tags/v*", "--format=%(refname:short) %(creatordate:unix)"
    ).splitlines():
        tag, _, when = line.partition(" ")
        if (
            stable_version(tag) is not None
        ):  # skip reading a pre-release's contract at all
            tags.append((tag, float(when), _tag_contract(tag)))
    expected = newest_for_contract(tags, uploaded, server)

    print(
        f"pymaxim {version}: server contract {server}, {label} {datetime.fromtimestamp(uploaded):%Y-%m-%d %H:%M}"
    )
    print(
        f"  vendored: {stamp.get('target')} {stamp.get('app_version')} built at {stamp.get('describe')}"
        f" (contract {stamp.get('contract_version')}, dirty {stamp.get('dirty')})"
    )
    print(
        f"  expected: {expected or 'no pulse tag for this contract existed at upload time'}"
    )
    problems = []
    if stamp.get("contract_version") != server:
        problems.append(
            f"the bundle was built for contract {stamp.get('contract_version')}, the server is {server}"
        )
    if stamp.get("dirty") is not False:
        problems.append("the bundle was built from a dirty tree")
    # Compare COMMITS, not describe strings: a bundle built on the exact commit
    # before its tag was pushed (1.3.1's, `v0.2.0-4-g64f09e7` = v0.3.0) is the
    # right content under an older name.
    tag_commit = _git("rev-parse", f"{expected}^{{commit}}").strip() if expected else ""
    vendored_commit = str(stamp.get("commit") or "")
    if not (vendored_commit and tag_commit.startswith(vendored_commit)):
        problems.append(
            f"vendored {stamp.get('describe')}, but the newest pulse tag for {server} was {expected}"
        )
    for problem in problems:
        print(f"FAIL  {problem}")
    if not problems:
        print("PASS  the wheel vendors the newest pulse bundle for its contract")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
