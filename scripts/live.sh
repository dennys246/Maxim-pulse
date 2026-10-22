#!/usr/bin/env bash
# See pulse running, live: both consoles, signed in, over a real pymaxim — in one command.
#
#   scripts/live.sh                                   # main × the newest pymaxim on PyPI
#   scripts/live.sh --pymaxim 1.3.3 --with 42         # main + PR #42 × pymaxim 1.3.3
#   scripts/live.sh --pymaxim dist/pymaxim-X.whl --sha256 d1ef…   # a candidate wheel
#
#   --pymaxim <version|wheel>  the backend (default: newest on PyPI)
#   --sha256 <hex>             refuse a wheel whose sha256 differs
#   --ref <git ref>            the pulse tree to build (default: origin/main)
#   --with <PR#>               merge an open PR into it first (repeatable)
#   --agent                    copy YOUR LLM routing + keys (~/.config/maxim, never the console
#                              token) so the desktop console can run a real agent
#   --signed-out               open the consoles at the sign-in screen, not signed in
#   --port <N>                 desktop on N, Reachy on N+1 (default 8765; a stored browser
#                              token is per port, so keep the default for day-to-day use)
#   --no-open                  don't open a browser
#   --check                    start everything, verify it answers, then exit (self-test)
#
# Builds the tree in a throwaway worktree, installs pymaxim into a throwaway venv + HOME, seeds a
# run history with pymaxim's own writers, serves the desktop Console (:8765, `maxim serve`) and
# the Reachy console (:8766, a device-shaped build_app with a stub announcer), and prints the
# code the "robot" speaks. Your checkout, ~/.maxim and console token are never touched;
# quitting (q or Ctrl-C) deletes everything it made.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
pymaxim="" sha256="" ref="origin/main" prs="" agent=0 signed_out=0 open_browser=1 check=0 port=8765
while [ $# -gt 0 ]; do
  case "$1" in
    --pymaxim) pymaxim="$2"; shift 2 ;;
    --sha256) sha256="$2"; shift 2 ;;
    --ref) ref="$2"; shift 2 ;;
    --with) prs="$prs $2"; shift 2 ;;
    --agent) agent=1; shift ;;
    --signed-out) signed_out=1; shift ;;
    --port) port="$2"; shift 2 ;;
    --no-open) open_browser=0; shift ;;
    --check) check=1; open_browser=0; shift ;;
    --) shift ;; # `pnpm live -- …` forwards the separator
    -h | --help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "live: unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done
desktop_port=$port device_port=$((port + 1))
for p in $desktop_port $device_port; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    echo "live: port $p is in use — stop whatever serves there, or pass --port <N>" >&2
    exit 1
  fi
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
T="$(mktemp -d /tmp/pulse-live.XXXX)"
pids=""
cleanup() {
  trap - EXIT INT TERM
  stty sane 2>/dev/null || true
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  pkill -f "$T/venv/" 2>/dev/null || true # backstop: anything still running from THIS throwaway venv
  wait 2>/dev/null || true
  git -C "$repo" worktree remove --force "$T/pulse" 2>/dev/null || true
  rm -rf "$T"
  say "live: stopped; everything under $T is gone."
}
trap cleanup EXIT INT TERM

# ── the pulse tree ──────────────────────────────────────────────────────────
say "live: building $ref${prs:+ + PR$prs} …"
git -C "$repo" fetch -q origin
git -C "$repo" worktree add -q --detach "$T/pulse" "$ref"
cd "$T/pulse"
for pr in $prs; do
  git fetch -q origin "pull/$pr/head"
  # A throwaway local merge: never signed, never pushed, gone at cleanup.
  if ! git -c commit.gpgsign=false -c user.name=live -c user.email=live@localhost \
    merge -q --no-ff --no-edit -m "live: merge PR #$pr" FETCH_HEAD; then
    echo "live: PR #$pr does not merge cleanly onto $ref — rebase it first" >&2
    exit 1
  fi
done
tree="$(git log -1 --format=%h) ($ref${prs:+ + PR$prs})"
pnpm install --frozen-lockfile >/dev/null
pnpm build >/dev/null

# ── pymaxim ─────────────────────────────────────────────────────────────────
if [ -z "$pymaxim" ]; then
  spec="pymaxim[console]"
elif [ -f "$pymaxim" ]; then
  actual="$(shasum -a 256 "$pymaxim" | cut -d' ' -f1)"
  if [ -n "$sha256" ] && [ "$actual" != "$sha256" ]; then
    echo "live: $pymaxim has sha256 $actual, expected $sha256 — refusing to install it" >&2
    exit 1
  fi
  spec="$(cd "$(dirname "$pymaxim")" && pwd)/$(basename "$pymaxim")[console]"
  echo "live: wheel sha256 $actual"
else
  spec="pymaxim[console]==$pymaxim"
fi
say "live: installing $spec …"
uv venv -q -p 3.12 "$T/venv"
uv pip install -q -p "$T/venv" "$spec"
version="$("$T/venv/bin/python" -c 'from importlib.metadata import version; print(version("pymaxim"))')"

mkdir -p "$T/home/.config/maxim"
# `env` EXECs the command, so a backgrounded `mx … &` records the server's own PID
# (a shell function would record a subshell, and killing it leaves the server running).
mx() { env HOME="$T/home" MAXIM_DATA_HOME="$T/home/.maxim" XDG_CONFIG_HOME="$T/home/.config" "$@"; }
if [ "$agent" = 1 ]; then
  for f in "$HOME"/.config/maxim/*; do
    case "$(basename "$f")" in console_token* | *.lock) ;; *) [ -f "$f" ] && cp "$f" "$T/home/.config/maxim/" ;; esac
  done
  echo "live: copied your LLM routing + keys into the throwaway home (not your console token)"
fi
mx "$T/venv/bin/python" e2e/seed_history.py >/dev/null

# ── the two consoles ────────────────────────────────────────────────────────
desktop_ui="built"
start_desktop() {
  if [ "$desktop_ui" = built ]; then
    env HOME="$T/home" MAXIM_DATA_HOME="$T/home/.maxim" XDG_CONFIG_HOME="$T/home/.config" \
      "$T/venv/bin/maxim" serve --ui-dist apps/console/dist --port $desktop_port >"$T/desktop.log" 2>&1 &
  else
    env HOME="$T/home" MAXIM_DATA_HOME="$T/home/.maxim" XDG_CONFIG_HOME="$T/home/.config" \
      "$T/venv/bin/maxim" serve --port $desktop_port >"$T/desktop.log" 2>&1 &
  fi
  desktop_pid=$!
  pids="$pids $desktop_pid"
}
wait_up() {
  for _ in $(seq 1 80); do curl -fs "$1/api/hello" >/dev/null 2>&1 && return 0; sleep 0.25; done
  echo "live: $1 never came up:" >&2
  tail -20 "$T/desktop.log" "$T/device.log" >&2
  exit 1
}
start_desktop
env HOME="$T/home" MAXIM_DATA_HOME="$T/home/.maxim" XDG_CONFIG_HOME="$T/home/.config" \
  "$T/venv/bin/python" e2e/device_server.py apps/reachy/ui/dist $device_port "$T/spoken.txt" >"$T/device.log" 2>&1 &
pids="$pids $!"
DESKTOP="http://127.0.0.1:$desktop_port" DEVICE="http://127.0.0.1:$device_port"
wait_up "$DESKTOP"
wait_up "$DEVICE"
token() { mx "$T/venv/bin/maxim" serve --show-token | grep -oE 'mxc_[A-Za-z0-9_-]{43}'; }
url() { if [ "$signed_out" = 1 ]; then echo "$1/"; else echo "$1/#token=$(token)"; fi; }
open_url() {
  [ "$open_browser" = 1 ] || return 0
  if command -v open >/dev/null; then open "$1"; elif command -v xdg-open >/dev/null; then xdg-open "$1" >/dev/null 2>&1; fi
}

# The robot's ears: print every code the stub announcer "speaks".
(
  last=""
  while sleep 0.3; do
    [ -f "$T/spoken.txt" ] || continue
    stamp="$(ls -l "$T/spoken.txt" 2>/dev/null)$(cat "$T/spoken.txt" 2>/dev/null)"
    if [ "$stamp" != "$last" ]; then
      last="$stamp"
      printf '\n\033[1;35m🔊 the robot says: %s\033[0m\n' "$(cat "$T/spoken.txt")"
    fi
  done
) &
pids="$pids $!"
disown $! # quitting kills it; no "Terminated" notice

checklist() {
  cat <<EOF

$(say "Pulse is live")  pulse $tree  ×  pymaxim $version (contract $(curl -fs "$DESKTOP/api/hello" | sed -E 's/.*"contract_version":"([^"]+)".*/\1/'))
  Desktop Console  $DESKTOP   (bundle: $desktop_ui)
  Reachy console   $DEVICE   (stub voice: codes print here)

What to look at (the e2e suite already proves the rest):
  Desktop  · no yellow "Contract mismatch" banner · health strip "CPU n% · RAM n%" updates
           · Logs → Runs: open the top run — action 2 "booked by bridge · rpe −0.42 · pain 0.30"
           · Logs → Health: "no agent loop is running in this process"
           · press r, then click Logs: the paste screen with the "rotated" hint; t, paste, back in
  Reachy   · in a private window ($DEVICE/): two ways in; "Have the robot say a code"
             → the code prints here; type 000000 first ("Wrong code."), then the real one
           · right rail only, no Models / GitHub, Settings is setup only, health strip
$( [ "$agent" = 1 ] && echo "  Agent    · send a short task in the Desktop chat: the activity + thinking panels fill live;
             then Logs → Runs shows it at the top with real credit chips" )
Keys:  r rotate token · t token + signed-in links · s switch desktop bundle (built ⇄ shipped in the wheel)
       o open both again · h this help · q quit (deletes everything)
Also:  scripts/release-acceptance.sh <pymaxim> — the automated checks, incl. the robot install
EOF
}

if [ "$check" = 1 ]; then
  code_status="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -H "Origin: $DEVICE" -d '{}' "$DEVICE/api/pair/request")"
  for _ in $(seq 1 40); do [ -s "$T/spoken.txt" ] && break; sleep 0.25; done
  desktop_hello="$(curl -fs "$DESKTOP/api/hello")"
  device_hello="$(curl -fs "$DEVICE/api/hello")"
  echo "live check: desktop $desktop_hello"
  echo "live check: device  $device_hello"
  echo "live check: pair request HTTP $code_status, code spoken: $([ -s "$T/spoken.txt" ] && echo yes || echo NO)"
  echo "live check: token $(token | sed -E 's/^(mxc_....).*/\1…/')"
  if [[ "$desktop_hello" == *'"pairing":"none"'* && "$device_hello" == *'"pairing":"available"'* &&
    "$code_status" == 202 && -s "$T/spoken.txt" ]]; then
    echo "LIVE CHECK PASSED"
    exit 0
  fi
  echo "LIVE CHECK FAILED"
  exit 1
fi

checklist
open_url "$(url "$DESKTOP")"
open_url "$(url "$DEVICE")"
while true; do
  IFS= read -rsn1 key || break
  case "$key" in
    r)
      mx "$T/venv/bin/maxim" serve --rotate-token >/dev/null
      say "token rotated — the next thing you do in either console lands on the paste screen; t shows the new one"
      ;;
    t) echo "token: $(token)"; echo "  $DESKTOP/#token=$(token)"; echo "  $DEVICE/#token=$(token)" ;;
    s)
      kill "$desktop_pid" 2>/dev/null || true
      wait "$desktop_pid" 2>/dev/null || true
      if [ "$desktop_ui" = built ]; then desktop_ui="shipped in the wheel"; else desktop_ui=built; fi
      start_desktop
      wait_up "$DESKTOP"
      say "desktop now serves: $desktop_ui — reload the page"
      ;;
    o) open_url "$(url "$DESKTOP")"; open_url "$(url "$DEVICE")" ;;
    h) checklist ;;
    q) break ;;
  esac
done
