#!/usr/bin/env bash
# Release smoke for the Reachy bootstrap — see scripts/smoke_reachy_release.py.
#
#   scripts/smoke-reachy-release.sh            # the robot extra's pymaxim floor
#   scripts/smoke-reachy-release.sh 1.3.3      # an exact published version
#   PYMAXIM_SPEC=/path/to/pymaxim-1.3.3-py3-none-any.whl scripts/smoke-reachy-release.sh
#                                              # a candidate wheel, before it is released
#
# Everything lands in a throwaway venv and HOME: the real ~/.maxim and
# ~/.config/maxim are never touched. Builds the Reachy bundle if it is missing.
# Needs uv. Trust the audio check on Linux only (piper's macOS arm64 wheel is
# broken); CI runs this on Linux arm64, the robot's platform.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
pin_floor() {
  sed -nE 's/^robot = \["pymaxim\[[^]]*\]>=([0-9][0-9.]*).*/\1/p' "$repo/apps/reachy/pyproject.toml"
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

echo "smoke: installing $spec (with the console + tts extras; the robot itself is faked)"
uv venv -q -p 3.12 "$work/venv"
# `reachy` (the Pollen SDK) is deliberately left out: the robot is the one fake.
case "$spec" in
  *.whl) uv pip install -q -p "$work/venv" "${spec}[console,tts]" ;;
  *) uv pip install -q -p "$work/venv" "${spec/pymaxim/pymaxim[console,tts]}" ;;
esac

HOME="$work/home" \
  MAXIM_DATA_HOME="$work/home/.maxim" \
  XDG_CONFIG_HOME="$work/home/.config" \
  "$work/venv/bin/python" "$repo/scripts/smoke_reachy_release.py" \
  --reachy-app "${REACHY_APP:-$repo/apps/reachy}" \
  --ui-dist "$repo/apps/reachy/ui/dist" \
  2>&1 | tr '\r' '\n' | grep -vE '^\s*\[[=-]*\]|^\s*$' # drop the voice download's progress bar
