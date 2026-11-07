# Robot test scripts (owner, real Reachy Mini)

Run from a laptop on the robot's network. Neither script is part of CI: they touch real hardware.

- **`watch_body_yaw.py`**: the body-yaw check for pulse #64 / pymaxim #1499.
  - Reads the daemon's read-only `GET :8000/api/state/full`. It never connects as an SDK client: every `ReachyMini()` sends `automatic_body_yaw` on connect (default `True`) and the setting is daemon-wide.
  - Verdict: PASS when the body stays within 2° of its target while the head holds ≥ 55° from it. INCONCLUSIVE if the head never got there.
  - Standard library only.
- **`measure_antennas.py`**: hand-measures the antenna range.
  - Stop the Maxim app first. The script turns off only the antenna motors and reads joint positions.
  - Needs `reachy-mini` at the daemon's version.
  - It opens the robot with `automatic_body_yaw=False, media_backend="no_media"`, as every SDK-client test script should.

Automatic yaw is a clamp, not a trigger. It moves the body only by how far the head is past 65° from the body target (`reachy-mini-rust-kinematics` `inverse_kinematics_safe`). Maxim's controller clamps at exactly 65°, so a test only shows something if the head reaches that limit.

The test plan is pymaxim `docs/plans/motion_path_model.md` §13. It waits for #1499 PR 3. **Never** command the head past 65° to provoke the drag on the robot: with the setting off, that goes to the unclamped IK. Use `reachy-mini-daemon --sim` for that.
