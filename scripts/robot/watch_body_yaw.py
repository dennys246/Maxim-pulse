"""Watch Reachy Mini's head yaw and body yaw while Maxim moves, without touching either.

Reads the daemon's own read-only HTTP state (GET /api/state/full). It does NOT connect
as an SDK client: every ReachyMini() sends automatic_body_yaw on connect (default
True) and the setting is daemon-wide, so an SDK watcher would change what it measures.

    python3 watch_body_yaw.py [--host reachy-mini.local]

The SDK's automatic body yaw turns the body only when the head is more than 65° from it
(kinematics/analytical_kinematics.py). So the test is not "the body never moves": Maxim may
turn the body on purpose. It is "the body goes only where it was told" - the present body
yaw tracks the daemon's TARGET body yaw. With automatic yaw on, the body moves on its own
and the two part.

Maxim's controller clamps head yaw at exactly ±65° from the body, the same threshold, so
head TRACKING can reach it (pymaxim motion_path_model.md §13). A run only counts if the
head got near that limit: the summary prints the closest it came, in tracking and in
discrete moves alike.

The pass gap is read only during the HOLD (head ≥ 55° from the body): a deliberate body
turn lags its target mid-move, and that is not a failure. Automatic yaw keeps the head
within 65° of the body while it turns the body, so a flip during the hold stays inside
the window. The whole-run gap is printed for information only.

Ctrl-C prints the verdict: PASS, FAIL, or INCONCLUSIVE.
Standard library only.
"""

import argparse
import json
import math
import time
import urllib.request

HOLD_DEG = 55.0  # head-to-body yaw that counts as holding near the 65° clamp
PASS_GAP_DEG = 2.0  # largest body-vs-target gap allowed during the hold
MIN_HOLD_SAMPLES = 5  # 1 s at 5 Hz


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="reachy-mini.local")
    parser.add_argument("--port", type=int, default=8000, help="the daemon's port")
    args = parser.parse_args()
    url = f"http://{args.host}:{args.port}/api/state/full?with_head_pose=true&with_body_yaw=true&with_target_body_yaw=true"

    max_relative = 0.0
    max_gap = 0.0
    hold_gap = 0.0
    hold_samples = 0
    print("Watching. Ask Maxim to look far left and far right. Ctrl-C to finish.\n")
    try:
        while True:
            with urllib.request.urlopen(url, timeout=3) as response:
                state = json.load(response)
            head = math.degrees(state["head_pose"]["yaw"])
            body = math.degrees(state["body_yaw"])
            target = state.get("target_body_yaw")
            target = math.degrees(target) if target is not None else 0.0
            relative = abs(head - body)
            gap = abs(body - target)
            max_relative = max(max_relative, relative)
            max_gap = max(max_gap, gap)
            if relative >= HOLD_DEG:
                hold_samples += 1
                hold_gap = max(hold_gap, gap)
            print(
                f"head yaw {head:+7.1f}°   body yaw {body:+7.1f}°   told {target:+7.1f}°",
                end="\r",
            )
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    print(f"\n\nLargest head-to-body yaw: {max_relative:.1f}° (the clamp is 65°)")
    print(f"Samples in the hold (≥ {HOLD_DEG:.0f}°): {hold_samples}")
    print(
        f"Gap during the hold: {hold_gap:.1f}°   (whole run, for information: {max_gap:.1f}°)"
    )
    if hold_samples < MIN_HOLD_SAMPLES:
        print(
            "INCONCLUSIVE: the head never held near the limit, so this run cannot show automatic yaw."
        )
    elif hold_gap <= PASS_GAP_DEG:
        print(
            "PASS: the body stayed where it was told while the head held at the limit."
        )
    else:
        print(
            "FAIL: the body moved away from where it was told while the head held at the limit."
        )


if __name__ == "__main__":
    main()
