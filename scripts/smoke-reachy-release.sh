#!/usr/bin/env bash
# Release smoke for the Reachy bootstrap — see scripts/smoke_reachy_release.py.
#
#   scripts/smoke-reachy-release.sh            # the robot extra's pymaxim floor
#   scripts/smoke-reachy-release.sh 1.3.3      # an exact published version
#   PYMAXIM_SPEC=/path/to/pymaxim-1.3.3-py3-none-any.whl scripts/smoke-reachy-release.sh
#                                              # a candidate wheel, before it is released
#   SMOKE_INSTALL=app scripts/smoke-reachy-release.sh 1.3.3
#                     # the ROBOT install: assemble the app with its bundle in ui_dist/,
#                     # pip-install it with the real [robot] extra (Pollen SDK included),
#                     # `pip check` the result, and smoke the INSTALLED package. Linux only.
#   SMOKE_PYTHON=3.10  the venv's Python (default 3.12)
#   REACHY_APP=<dir>   the app to smoke (default apps/reachy), e.g. an unmerged PR's
#
# Everything lands in a throwaway venv and HOME: the real ~/.maxim and
# ~/.config/maxim are never touched. Builds the Reachy bundle if it is missing.
# Needs uv. Trust the audio check on Linux only (piper's macOS arm64 wheel is
# broken); CI runs this on Linux arm64, the robot's platform.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
app="${REACHY_APP:-$repo/apps/reachy}"
python="${SMOKE_PYTHON:-3.12}"
pin_floor() {
  sed -nE 's/^robot = \["pymaxim\[[^]]*\]>=([0-9][0-9.]*).*/\1/p' "$app/pyproject.toml"
}
version="${1:-$(pin_floor)}"
spec="${PYMAXIM_SPEC:-pymaxim==$version}"
[ -n "$spec" ] || { echo "no pymaxim version given and no pin floor found" >&2; exit 2; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home"

if [ ! -f "$repo/apps/reachy/ui/dist/maxim-ui.json" ]; then
  (cd "$repo" && pnpm --filter @maxim/reachy-ui build >/dev/null)
fi

uv venv -q -p "$python" "$work/venv"
if [ "${SMOKE_INSTALL:-}" = app ]; then
  # What the robot does: the app's checkout, with reachy-dist extracted into ui_dist/.
  mkdir -p "$work/app"
  (cd "$app" && tar --exclude=./ui --exclude=./tests --exclude='*.egg-info' -cf - .) | tar -xf - -C "$work/app"
  rm -rf "$work/app/maxim_reachy_app/ui_dist" && mkdir -p "$work/app/maxim_reachy_app/ui_dist"
  cp -R "$repo/apps/reachy/ui/dist/." "$work/app/maxim_reachy_app/ui_dist/"
  echo "smoke: ROBOT install — the app with its [robot] extra (Pollen SDK included), pymaxim $spec, Python $python"
  case "$spec" in
    *.whl) # an unreleased wheel can't satisfy the app's version pin by name: install it, then the app
      uv pip install -q -p "$work/venv" "${spec}[console,reachy,tts]"
      uv pip install -q -p "$work/venv" "$work/app" ;;
    *) uv pip install -q -p "$work/venv" "$work/app[robot]" "${spec/pymaxim/pymaxim[console,reachy,tts]}" ;;
  esac
  if uv pip check -p "$work/venv" >"$work/check.txt" 2>&1; then
    echo "PASS  the robot install's dependencies are consistent (pip check)"
  else
    echo "FAIL  the robot install's dependencies conflict (pip check):"
    sed 's/^/      /' "$work/check.txt"
    check_failed=1
  fi
  smoke_args=(--installed)
else
  echo "smoke: installing $spec (with the console + tts extras; the robot itself is faked), Python $python"
  # `reachy` (the Pollen SDK) is deliberately left out: the robot is the one fake.
  case "$spec" in
    *.whl) uv pip install -q -p "$work/venv" "${spec}[console,tts]" ;;
    *) uv pip install -q -p "$work/venv" "${spec/pymaxim/pymaxim[console,tts]}" ;;
  esac
  smoke_args=(--reachy-app "$app" --ui-dist "$repo/apps/reachy/ui/dist")
fi

set +e
(cd "$work" && HOME="$work/home" \
  MAXIM_DATA_HOME="$work/home/.maxim" \
  XDG_CONFIG_HOME="$work/home/.config" \
  "$work/venv/bin/python" "$repo/scripts/smoke_reachy_release.py" "${smoke_args[@]}") \
  2>&1 | tr '\r' '\n' | grep -vE '^\s*\[[=-]*\]|^\s*$' # drop the voice download's progress bar
smoke_status=${PIPESTATUS[0]}
set -e
if [ "${check_failed:-0}" = 1 ]; then
  echo "SMOKE FAILED: the robot install's dependencies conflict"
  exit 1
fi
exit "$smoke_status"
