#!/usr/bin/env bash
# Browser end-to-end suite: the BUILT bundles in real Chrome against a real, published pymaxim.
#
#   scripts/e2e.sh                 # the newest pymaxim on PyPI
#   scripts/e2e.sh 1.3.2           # an exact version
#   PYMAXIM_SPEC=/path/to/pymaxim-X-py3-none-any.whl scripts/e2e.sh   # a candidate wheel
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

echo "e2e: installing $spec (console extra) into a throwaway venv"
uv venv -q -p 3.12 "$work/venv"
case "$spec" in
  *.whl) uv pip install -q -p "$work/venv" "${spec}[console]" ;;
  *) uv pip install -q -p "$work/venv" "${spec/pymaxim/pymaxim[console]}" ;;
esac
py="$work/venv/bin/python"

export HOME="$work/home" MAXIM_DATA_HOME="$work/home/.maxim" XDG_CONFIG_HOME="$work/home/.config"
mkdir -p "$HOME"
echo "e2e: pymaxim $("$py" -c 'from importlib.metadata import version; print(version("pymaxim"))')"
"$py" "$repo/e2e/seed_history.py"

free_port() { "$py" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }
desktop_port="$(free_port)"
device_port="$(free_port)"
"$work/venv/bin/maxim" serve --ui-dist "$repo/apps/console/dist" --port "$desktop_port" >"$work/desktop.log" 2>&1 &
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

status=0
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
