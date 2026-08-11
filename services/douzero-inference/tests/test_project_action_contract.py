from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import unittest


SOURCE_ROOT = Path(__file__).parents[1] / "src"
REPOSITORY_ROOT = Path(__file__).parents[3]
EXPORT_SCRIPT = Path(__file__).parent / "export_project_action_cases.mjs"
sys.path.insert(0, str(SOURCE_ROOT))

from douzero_inference import build_rankable_infoset


class ProjectActionContractTests(unittest.TestCase):
    def test_reachable_project_actions_canonicalize_and_map_back(self):
        game_core = REPOSITORY_ROOT / "packages" / "game-core" / "dist" / "index.js"
        coach_protocol = (
            REPOSITORY_ROOT / "packages" / "coach-protocol" / "dist" / "index.js"
        )
        if not game_core.is_file() or not coach_protocol.is_file():
            self.skipTest("Build game-core and coach-protocol before contract validation")
        result = subprocess.run(
            ["node", str(EXPORT_SCRIPT)],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        cases = json.loads(result.stdout)

        self.assertGreaterEqual(len(cases), 30)
        observed_positions = set()
        observed_physical_duplicates = False
        for case in cases:
            state = case["state"]
            legal_actions = case["legalActions"]
            rankable = build_rankable_infoset(state, legal_actions)
            observed_positions.add(rankable.infoset.player_position)
            source_ids = {action["actionId"] for action in legal_actions}
            canonical = rankable.action_set.actions

            self.assertEqual(
                len(rankable.action_set.douzero_actions),
                len(set(rankable.action_set.douzero_actions)),
            )
            self.assertTrue(
                all(action.action_id in source_ids for action in canonical),
            )
            self.assertEqual(
                rankable.action_set,
                build_rankable_infoset(state, list(reversed(legal_actions))).action_set,
            )
            if len(canonical) < len(legal_actions):
                observed_physical_duplicates = True

        self.assertEqual(
            observed_positions,
            {"landlord", "landlord_up", "landlord_down"},
        )
        self.assertTrue(observed_physical_duplicates)


if __name__ == "__main__":
    unittest.main()
