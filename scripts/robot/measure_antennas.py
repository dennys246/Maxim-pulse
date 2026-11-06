"""Measure Reachy Mini's antenna range by hand: antenna motors off, joint readback on.

Run from a laptop on the robot's network, with the Maxim app STOPPED in Pollen's
dashboard (two controllers fighting over the antennas is exactly what this avoids).

    python measure_antennas.py [--host reachy-mini.local]

Then move each antenna slowly by hand to each end of its travel. Ctrl-C prints the
range seen. Only the two antenna motors are switched off; head and body stay put.
Before re-enabling, the target is set to where each antenna IS, so nothing snaps.
"""

import argparse
import math
import time

from reachy_mini import ReachyMini

# The SDK order of get_present_antenna_joint_positions().
ANTENNAS = ["right_antenna", "left_antenna"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="reachy-mini.local")
    args = parser.parse_args()

    # no_media: the SDK's default media backend starts WebRTC/GStreamer, which this script
    # does not need and which fails to load on a Mac without GStreamer.
    with ReachyMini(
        host=args.host, automatic_body_yaw=False, media_backend="no_media"
    ) as mini:
        lo = [math.inf, math.inf]
        hi = [-math.inf, -math.inf]
        mini.disable_motors(ids=ANTENNAS)
        print(
            "Antenna motors OFF. Move each antenna by hand to both ends. Ctrl-C to finish.\n"
        )
        try:
            while True:
                now = mini.get_present_antenna_joint_positions()
                for i, v in enumerate(now):
                    lo[i] = min(lo[i], v)
                    hi[i] = max(hi[i], v)
                print(
                    "  ".join(
                        f"{name}: {math.degrees(v):7.1f}°"
                        for name, v in zip(ANTENNAS, now)
                    ),
                    end="\r",
                )
                time.sleep(0.1)
        except KeyboardInterrupt:
            pass
        finally:
            here = mini.get_present_antenna_joint_positions()
            mini.set_target_antenna_joint_positions(here)
            mini.enable_motors(ids=ANTENNAS)

    print("\n\nRange seen (motors off, hand-moved):")
    for i, name in enumerate(ANTENNAS):
        print(
            f"  {name}: {lo[i]:+.3f} .. {hi[i]:+.3f} rad"
            f"  ({math.degrees(lo[i]):+.1f}° .. {math.degrees(hi[i]):+.1f}°)"
        )


if __name__ == "__main__":
    main()
