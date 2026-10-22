#!/usr/bin/env bash
# Release acceptance (Tier A of docs/release-checklist.md): does pulse fully work on this pymaxim?
#
#   scripts/release-acceptance.sh 1.3.3                       # a published release
#   scripts/release-acceptance.sh dist/pymaxim-X-py3-none-any.whl   # a candidate, before the cut
#
# Runs every automated check against what USERS actually install, and prints one verdict:
#   1. vendor     the wheel vendors the newest stable pulse tag for its contract
#   2. e2e        this checkout's build, Python 3.12                       (59 browser checks)
#   3. shipped    the bundle VENDORED IN THE WHEEL, oldest Python (3.10)   (what a desktop user gets)
#   4. upgrade    newest Python (3.14), state written by the previous release, then upgraded
#   5. robot      the app pip-installed with the real [robot] extra (Pollen SDK), on linux/arm64:
#                 natively on a Linux arm64 host, else in Docker, else SKIPPED (verdict INCOMPLETE)
#
# Options (environment): REACHY_APP=<dir> smokes an unmerged app (e.g. a PR's apps/reachy);
# FROM=<version> overrides the upgrade's starting release; STEPS="vendor e2e" runs a subset
# (CI splits the desktop steps and the robot step across runners). Every step runs in a throwaway venv
# and HOME. Logs land in $ACCEPTANCE_LOGS (default: a temp dir, printed at the end).
set -uo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:?usage: scripts/release-acceptance.sh <pymaxim version | path to wheel>}"
logs="${ACCEPTANCE_LOGS:-$(mktemp -d)}"
mkdir -p "$logs"

if [ -f "$target" ]; then
  wheel="$(cd "$(dirname "$target")" && pwd)/$(basename "$target")"
  export PYMAXIM_SPEC="$wheel"
  version_args=()
  vendor_args=(--wheel "$wheel")
  label="candidate $(basename "$wheel") (sha256 $(shasum -a 256 "$wheel" | cut -c1-16)…)"
else
  wheel=""
  version_args=("$target")
  vendor_args=("$target")
  label="pymaxim $target"
fi

# The release users upgrade FROM: the newest published release older than the target.
from="${FROM:-$(python3 - "$target" <<'EOF'
import json, re, sys, urllib.request
target = sys.argv[1]
with urllib.request.urlopen("https://pypi.org/pypi/pymaxim/json", timeout=30) as r:
    releases = json.load(r)["releases"]
key = lambda v: tuple(int(x) for x in v.split("."))
stable = sorted((v for v in releases if re.fullmatch(r"\d+\.\d+\.\d+", v)), key=key)
if re.fullmatch(r"\d+\.\d+\.\d+", target):
    stable = [v for v in stable if key(v) < key(target)]
print(stable[-1] if stable else "")
EOF
)}"

steps=" ${STEPS:-vendor e2e shipped upgrade robot} "
declare -a names results
run() { # name, then the command
  local name="$1"
  shift
  [[ "$steps" == *" $name "* ]] || return 0
  echo "── $name ──"
  if "$@" >"$logs/$name.log" 2>&1; then
    results+=(PASS)
  else
    results+=(FAIL)
  fi
  names+=("$name")
  grep -E '^(PASS|FAIL)  |^(E2E|SMOKE) |^[a-z]+: [0-9]+/' "$logs/$name.log" | grep -vE '^PASS  ' | sed 's/^/   /'
  echo "   → ${results[${#results[@]}-1]}  (log: $logs/$name.log)"
}
skip() {
  [[ "$steps" == *" $1 "* ]] || return 0
  echo "── $1 ──"
  echo "   → SKIPPED: $2"
  names+=("$1")
  results+=(SKIPPED)
}

echo "Release acceptance for $label"
(cd "$repo" && git fetch -q --tags origin 2>/dev/null) || true

run vendor python3 "$repo/scripts/check_pymaxim_vendor.py" "${vendor_args[@]}"
run e2e env E2E_UI=built E2E_PYTHON=3.12 "$repo/scripts/e2e.sh" ${version_args[@]+"${version_args[@]}"}
run shipped env E2E_UI=vendored E2E_PYTHON=3.10 "$repo/scripts/e2e.sh" ${version_args[@]+"${version_args[@]}"}
if [ -n "$from" ]; then
  run upgrade env E2E_UI=vendored E2E_PYTHON=3.14 E2E_UPGRADE_FROM="$from" "$repo/scripts/e2e.sh" ${version_args[@]+"${version_args[@]}"}
else
  skip upgrade "no earlier pymaxim release on PyPI"
fi

app="${REACHY_APP:-$repo/apps/reachy}"
app="$(cd "$app" && pwd)"
if [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = aarch64 ]; then
  run robot env SMOKE_INSTALL=app REACHY_APP="$app" "$repo/scripts/smoke-reachy-release.sh" ${version_args[@]+"${version_args[@]}"}
elif docker info >/dev/null 2>&1; then
  mounts=(-v "$repo:/pulse:ro" -v "$app:/app:ro")
  inner="SMOKE_INSTALL=app REACHY_APP=/app"
  if [ -n "$wheel" ]; then
    mounts+=(-v "$(dirname "$wheel"):/wheel:ro")
    inner="$inner PYMAXIM_SPEC=/wheel/$(basename "$wheel")"
  fi
  (cd "$repo" && pnpm --filter @maxim/reachy-ui build >/dev/null 2>&1)
  # The robot's OS image ships the native libs the Pollen SDK's gstreamer extra builds against.
  run robot docker run --rm --platform linux/arm64 "${mounts[@]}" python:3.12-slim bash -c "
    apt-get update -qq >/dev/null && apt-get install -y -qq gcc pkg-config libcairo2-dev libgirepository1.0-dev >/dev/null &&
    pip install -q uv >/dev/null 2>&1 && cp -r /pulse /work && cd /work &&
    $inner scripts/smoke-reachy-release.sh ${version_args[*]-}"
else
  skip robot "needs a Linux arm64 host or Docker (CI: release-acceptance.yml)"
fi

echo
echo "Summary for $label (upgrade from ${from:-none}):"
verdict=ACCEPTED
for i in "${!names[@]}"; do
  printf '  %-8s %s\n' "${names[$i]}" "${results[$i]}"
  case "${results[$i]}" in
    FAIL) verdict=REJECTED ;;
    SKIPPED) [ "$verdict" = ACCEPTED ] && verdict=INCOMPLETE ;;
  esac
done
echo "Logs: $logs"
echo "Tier B (live agent) and Tier C (robot) remain: docs/release-checklist.md"
echo "ACCEPTANCE $verdict${STEPS:+ (steps:$steps— the other steps were not run)}"
[ "$verdict" = ACCEPTED ]
