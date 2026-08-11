from __future__ import annotations

from itertools import combinations
from pathlib import Path
import sys
import unittest


SOURCE_ROOT = Path(__file__).parents[1] / "src"
TEST_ROOT = Path(__file__).parent
sys.path.insert(0, str(SOURCE_ROOT))
sys.path.insert(0, str(TEST_ROOT))

from douzero_inference import (
    build_rankable_infoset,
    canonicalize_legal_actions,
)
from test_state_adapter import make_visible_state


def card(card_id, rank):
    return {"id": card_id, "rank": rank, "suit": "spade", "order": 0}


def play_action(cards, play_type, action_id=None):
    physical_ids = sorted(item["id"] for item in cards)
    return {
        "actionId": action_id or f"play:{','.join(physical_ids)}",
        "action": "play",
        "cards": [dict(item) for item in cards],
        "play": {
            "cards": [dict(item) for item in cards],
            "type": play_type,
            "primaryRank": cards[-1]["rank"],
            "length": len(cards),
        },
    }


PASS_ACTION = {
    "actionId": "pass",
    "action": "pass",
    "cards": [],
    "play": None,
}


class ActionAdapterTests(unittest.TestCase):
    def setUp(self):
        self.sevens = [
            card("7-spade", "7"),
            card("7-heart", "7"),
            card("7-club", "7"),
            card("7-diamond", "7"),
        ]
        self.three = card("3-spade", "3")
        self.hand = [3, 7, 7, 7, 7]

    def test_collapses_physical_pair_variants_and_uses_smallest_action_id(self):
        pair_actions = [
            play_action(list(pair), "pair")
            for pair in combinations(self.sevens, 2)
        ]
        actions = [PASS_ACTION, *reversed(pair_actions), play_action([self.three], "single")]

        result = canonicalize_legal_actions(actions, self.hand)

        self.assertEqual(result.douzero_actions, ((3,), (7, 7), ()))
        pair = result.actions[1]
        expected_ids = tuple(sorted(action["actionId"] for action in pair_actions))
        self.assertEqual(pair.signature, "play:7x2")
        self.assertEqual(pair.action_id, expected_ids[0])
        self.assertEqual(pair.equivalent_action_ids, expected_ids)
        self.assertEqual(len(pair.equivalent_action_ids), 6)

    def test_is_deterministic_when_project_action_order_changes(self):
        actions = [
            PASS_ACTION,
            play_action(self.sevens[:2], "pair"),
            play_action([self.three], "single"),
            play_action(self.sevens[2:], "pair"),
        ]

        forward = canonicalize_legal_actions(actions, self.hand)
        reverse = canonicalize_legal_actions(list(reversed(actions)), self.hand)

        self.assertEqual(forward, reverse)

    def test_builds_infoset_with_only_canonical_model_actions(self):
        state = make_visible_state()
        hand_cards = state["userHand"]
        same_rank_cards = next(
            [card for card in hand_cards if card["rank"] == rank]
            for rank in {card["rank"] for card in hand_cards}
            if len([card for card in hand_cards if card["rank"] == rank]) >= 2
        )
        pair_variants = [
            play_action(list(pair), "pair")
            for pair in combinations(same_rank_cards, 2)
        ]
        legal_actions = [*pair_variants, PASS_ACTION]

        rankable = build_rankable_infoset(state, legal_actions)

        self.assertEqual(len(rankable.action_set.actions), 2)
        self.assertEqual(
            rankable.infoset.legal_actions,
            rankable.action_set.douzero_actions,
        )
        returned_ids = {
            action.action_id for action in rankable.action_set.actions
        }
        source_ids = {action["actionId"] for action in legal_actions}
        self.assertTrue(returned_ids <= source_ids)

    def test_resolves_model_indices_to_project_action_ids(self):
        actions = [
            play_action([self.three], "single"),
            play_action(self.sevens[:2], "pair"),
            PASS_ACTION,
        ]
        result = canonicalize_legal_actions(actions, self.hand)

        self.assertEqual(result.action_at_model_index(0).action_id, actions[0]["actionId"])
        self.assertEqual(result.action_at_model_index(2).action_id, "pass")
        with self.assertRaisesRegex(IndexError, "out of range"):
            result.action_at_model_index(3)
        with self.assertRaisesRegex(IndexError, "out of range"):
            result.action_at_model_index(-1)

    def test_rejects_malformed_or_non_hand_actions(self):
        malformed_pass = {**PASS_ACTION, "actionId": "not-pass"}
        with self.assertRaisesRegex(ValueError, "pass actionId"):
            canonicalize_legal_actions([malformed_pass], self.hand)

        outside_hand = play_action([card("A-spade", "A")], "single")
        with self.assertRaisesRegex(ValueError, "outside the player hand"):
            canonicalize_legal_actions([outside_hand], self.hand)

        mismatched = play_action([self.three], "single")
        mismatched["play"]["cards"] = [self.sevens[0]]
        with self.assertRaisesRegex(ValueError, "disagree"):
            canonicalize_legal_actions([mismatched], self.hand)

        duplicate = play_action([self.three], "single")
        duplicate_id_actions = [duplicate, duplicate]
        with self.assertRaisesRegex(ValueError, "duplicate legal action ID"):
            canonicalize_legal_actions(duplicate_id_actions, self.hand)

        wrong_action_id = play_action([self.three], "single", "play:not-the-card")
        with self.assertRaisesRegex(ValueError, "actionId disagrees"):
            canonicalize_legal_actions([wrong_action_id], self.hand)


if __name__ == "__main__":
    unittest.main()
