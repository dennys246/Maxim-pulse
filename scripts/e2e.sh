#!/usr/bin/env bash
# Browser end-to-end suite: the BUILT bundles in real Chrome against a real, published pymaxim.
#
#   scripts/e2e.sh                 # the newest pymaxim on PyPI
#   scripts/e2e.sh 1.3.2           # an exact version
#   PYMAXIM_SPEC=/path/to/pymaxim-X-py3-none-any.whl scripts/e2e.sh   # a candidate wheel
#
# Options (environment):
#   E2E_UI=vendored       serve the Console bundle VENDORED IN THE WHEEL (`maxim serve` with no
#                         --ui-dist), i.e. exactly what a desktop user gets. Default: built, this
#                         checkout's fresh build.
#   E2E_PYTHON=3.10       the venv's Python (default 3.12); run the oldest and newest supported.
#   E2E_UPGRADE_FROM=1.3.2  mint the console token and write the run history with THAT pymaxim
#                         first, then upgrade the same HOME to the target: the stored token must
#                         survive and the old history must read.
#
# Throwaway venv + HOME (the real ~/.maxim and console token are never touched;
# the auth suite ROTATES the temp one). Seeds a run history with pymaxim's own
# writers, starts `maxim serve` (desktop) and a device-shaped build_app (Reachy,
# stub announcer), then runs e2e/*.e2e.mjs. Needs uv, Node and Chrome.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:-}"
spec="${PYMAXIM_SPEC:-pymaxim${version:+==$version}}"

work="$(mktemp -d)"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

# Always rebuild: a stale dist/ would test yesterday's UI.
(cd "$repo" && pnpm --filter @maxim/console --filter @maxim/reachy-ui build >/dev/null)

ui="${E2E_UI:-built}"
python="${E2E_PYTHON:-3.12}"
export HOME="$work/home" MAXIM_DATA_HOME="$work/home/.maxim" XDG_CONFIG_HOME="$work/home/.config"
mkdir -p "$HOME"
install() { # venv spec
  uv venv -q -p "$python" "$1"
  case "$2" in
    *.whl) uv pip install -q -p "$1" "${2}[console]" ;;
    *) uv pip install -q -p "$1" "${2/pymaxim/pymaxim[console]}" ;;
  esac
}
pymaxim_version() { "$1/bin/python" -c 'from importlib.metadata import version; print(version("pymaxim"))'; }

status=0
if [ -n "${E2E_UPGRADE_FROM:-}" ]; then
  echo "e2e: upgrade path — writing state with pymaxim ${E2E_UPGRADE_FROM} first"
  install "$work/old" "pymaxim==${E2E_UPGRADE_FROM}"
  old_token="$("$work/old/bin/maxim" serve --show-token | grep -oE 'mxc_[A-Za-z0-9_-]{43}')"
  "$work/old/bin/python" "$repo/e2e/seed_history.py"
fi

echo "e2e: installing $spec (console extra, Python $python) into a throwaway venv"
install "$work/venv" "$spec"
py="$work/venv/bin/python"
echo "e2e: pymaxim $(pymaxim_version "$work/venv")"
if [ -n "${E2E_UPGRADE_FROM:-}" ]; then
  new_token="$("$work/venv/bin/maxim" serve --show-token | grep -oE 'mxc_[A-Za-z0-9_-]{43}')"
  if [ "$old_token" = "$new_token" ]; then
    echo "PASS  the console token minted by ${E2E_UPGRADE_FROM} survives the upgrade"
  else
    echo "FAIL  the console token minted by ${E2E_UPGRADE_FROM} changed on upgrade (every browser signed out)"
    status=1
  fi
else
  "$py" "$repo/e2e/seed_history.py"
fi

free_port() { "$py" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }
desktop_port="$(free_port)"
device_port="$(free_port)"
if [ "$ui" = vendored ]; then
  stamp="$("$py" -c 'import json, maxim.console, pathlib; print(json.loads((pathlib.Path(maxim.console.__file__).parent / "ui_dist" / "maxim-ui.json").read_text())["describe"])' 2>/dev/null || echo none)"
  echo "e2e: serving the Console bundle VENDORED in the wheel (built at $stamp)"
  serve_ui=()
else
  echo "e2e: serving this checkout's Console build"
  serve_ui=(--ui-dist "$repo/apps/console/dist")
fi
"$work/venv/bin/maxim" serve ${serve_ui[@]+"${serve_ui[@]}"} --port "$desktop_port" >"$work/desktop.log" 2>&1 &
pids+=($!)
"$py" "$repo/e2e/device_server.py" "$repo/apps/reachy/ui/dist" "$device_port" "$work/spoken_code.txt" >"$work/device.log" 2>&1 &
pids+=($!)

export E2E_DESKTOP="http://127.0.0.1:$desktop_port" E2E_DEVICE="http://127.0.0.1:$device_port"
export E2E_SPOKEN_FILE="$work/spoken_code.txt" E2E_MAXIM="$work/venv/bin/maxim"
for base in "$E2E_DESKTOP" "$E2E_DEVICE"; do
  for _ in $(seq 1 60); do curl -fs "$base/api/hello" >/dev/null && break || sleep 0.5; done
  curl -fs "$base/api/hello" >/dev/null || {
    echo "e2e: a server never came up" >&2
    cat "$work/desktop.log" "$work/device.log" >&2
    exit 1
  }
done

# auth runs LAST: it rotates the token every other suite signs in with.
for suite in shell logs pairing auth; do
  node "$repo/e2e/$suite.e2e.mjs" || status=1
done
if grep -q "No supported WebSocket library" "$work/desktop.log" "$work/device.log" 2>/dev/null; then
  echo "e2e: the server has NO WebSocket library, so /ws 404s and the live stream is dead." >&2
  echo "     That is a pymaxim packaging defect (its console extra), not a UI bug." >&2
fi
[ "$status" = 0 ] && echo "E2E PASSED" || echo "E2E FAILED"
exit "$status"
