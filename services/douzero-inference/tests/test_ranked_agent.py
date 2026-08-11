from __future__ import annotations

import math
from pathlib import Path
import sys
import unittest


SOURCE_ROOT = Path(__file__).parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from douzero_inference import rank_action_values


class RankActionValuesTests(unittest.TestCase):
    def test_top_one_matches_upstream_argmax_semantics(self):
        cases = [
            (["pass", "single-3", "pair-4"], [-0.4, 1.75, 0.2]),
            (["a", "b", "c"], [-3.0, -1.0, -2.0]),
            (["first", "second", "third"], [2.0, 2.0, 1.0]),
        ]

        for actions, values in cases:
            with self.subTest(values=values):
                upstream_index = max(
                    range(len(values)),
                    key=lambda index: values[index],
                )
                ranked = rank_action_values(actions, values, top_k=1)
                self.assertEqual(ranked[0].original_index, upstream_index)
                self.assertEqual(ranked[0].action, actions[upstream_index])

    def test_returns_stable_descending_top_k(self):
        ranked = rank_action_values(
            ["a", "b", "c", "d"],
            [0.5, 1.0, 1.0, -2.0],
            top_k=3,
        )

        self.assertEqual(
            [(item.action, item.value, item.original_index) for item in ranked],
            [("b", 1.0, 1), ("c", 1.0, 2), ("a", 0.5, 0)],
        )

    def test_caps_top_k_to_available_actions(self):
        ranked = rank_action_values(["a", "b"], [0.0, 1.0], top_k=5)
        self.assertEqual([item.action for item in ranked], ["b", "a"])

    def test_rejects_invalid_inputs(self):
        with self.assertRaisesRegex(ValueError, "positive integer"):
            rank_action_values(["a"], [1.0], top_k=0)
        with self.assertRaisesRegex(ValueError, "same length"):
            rank_action_values(["a"], [], top_k=1)
        for invalid_value in [math.nan, math.inf, -math.inf]:
            with self.subTest(value=invalid_value):
                with self.assertRaisesRegex(ValueError, "finite"):
                    rank_action_values(["a"], [invalid_value], top_k=1)


if __name__ == "__main__":
    unittest.main()
