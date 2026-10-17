"""Seed a throwaway run history with pymaxim's OWN writers (never hand-written files).

    MAXIM_DATA_HOME=<temp> python e2e/seed_history.py

The Logs explorer reads report.json and actions.jsonl. A hand-made fixture
would encode what we BELIEVE those files look like, the very mistake the suite
exists to catch. So the files are written by ``save_report`` and
``save_action_log``, whatever format the installed pymaxim writes; the only fake
is the bridge that hands ``save_action_log`` its action records.

Three runs, newest first in the list:
  e2e_20261016_090000  finished, three actions, per-action credit
  e2e_20261015_090000  finished, no actions file
  e2e_20261014_090000  aborted: actions but no report
"""

from __future__ import annotations

import time
from types import SimpleNamespace

from maxim.simulation.report import SimulationReport, save_action_log, save_report
from maxim.utils.paths import sim_reports


def _action(tool: str, success: bool, **credit: object) -> SimpleNamespace:
    record = {
        "timestamp": time.time(),
        "tool_name": tool,
        "tool_args": {},
        "result_success": success,
        "result_output": "ok" if success else None,
        "result_error": None if success else "e2e: the tool failed",
        "blocked": False,
        "block_reason": None,
        "agent_id": "e2e",
        "session_id": None,
        "entity_class": None,
        "rpe": None,
        "pain": None,
        "nac_failure_booked": None,
    }
    record.update(credit)
    return SimpleNamespace(**record)


class _Bridge:
    def __init__(self, actions: list[SimpleNamespace]) -> None:
        self._actions = actions

    def get_all_actions(self) -> list[SimpleNamespace]:
        return self._actions


def _ts(stamp: str) -> float:
    return time.mktime(time.strptime(stamp, "%Y%m%d_%H%M%S"))


def main() -> None:
    root = str(sim_reports())
    credited = "e2e_20261016_090000"
    report = SimulationReport(
        session_id=credited,
        goal="e2e: tidy the desk",
        mode="generative",
        duration_s=42.5,
        turns=3,
        finish_reason="goal_complete",
        total_actions=3,
    )
    if hasattr(report, "ts"):
        report.ts = _ts("20261016_090000")
    save_report(report, root)
    save_action_log(
        _Bridge(
            [
                _action("sense_tools", True),
                _action(
                    "sense_tools", False, rpe=-0.42, pain=0.3, nac_failure_booked=True
                ),
                _action("respond", True, rpe=0.12),
            ]
        ),
        root,
        credited,
    )

    bare = SimulationReport(
        session_id="e2e_20261015_090000", goal="e2e: no actions", turns=1
    )
    if hasattr(bare, "ts"):
        bare.ts = _ts("20261015_090000")
    save_report(bare, root)

    save_action_log(
        _Bridge([_action("sense_tools", True)]), root, "e2e_20261014_090000"
    )
    print(f"seeded 3 runs under {root}")


if __name__ == "__main__":
    main()
