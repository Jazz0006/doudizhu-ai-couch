from __future__ import annotations

from collections import Counter
from copy import deepcopy
from pathlib import Path
import sys
import unittest


SOURCE_ROOT = Path(__file__).parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from douzero_inference import (
    DOUZERO_DECK,
    build_infoset_dto,
    build_position_map,
    encode_rank,
)


RANKS = [
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
    "2",
]
SUITS = ["spade", "heart", "club", "diamond"]


def make_deck():
    cards = [
        {
            "id": f"{rank}-{suit}",
            "rank": rank,
            "suit": suit,
            "order": RANKS.index(rank),
        }
        for rank in RANKS
        for suit in SUITS
    ]
    cards.extend(
        [
            {
                "id": "small-joker",
                "rank": "small_joker",
                "suit": "joker",
                "order": 13,
            },
            {
                "id": "big-joker",
                "rank": "big_joker",
                "suit": "joker",
                "order": 14,
            },
        ]
    )
    return cards


def play_record(index, seat, cards, play_type="single"):
    return {
        "index": index,
        "seat": seat,
        "action": "play",
        "play": {
            "cards": cards,
            "type": play_type,
            "primaryRank": cards[-1]["rank"],
            "length": len(cards),
        },
        "timestamp": f"2026-08-10T00:00:{index:02d}.000Z",
    }


def pass_record(index, seat):
    return {
        "index": index,
        "seat": seat,
        "action": "pass",
        "play": None,
        "timestamp": f"2026-08-10T00:00:{index:02d}.000Z",
    }


def make_visible_state():
    deck = make_deck()
    by_id = {card["id"]: card for card in deck}
    played = [
        by_id["3-spade"],
        by_id["4-spade"],
        by_id["5-spade"],
        by_id["5-heart"],
        by_id["5-club"],
        by_id["5-diamond"],
    ]
    excluded_ids = {card["id"] for card in played}
    available = [card for card in deck if card["id"] not in excluded_ids]
    user_hand = available[:16]
    user_ids = {card["id"] for card in user_hand}
    bottom_cards = [card for card in available if card["id"] not in user_ids][-3:]
    history = [
        play_record(0, "left", [by_id["3-spade"]]),
        pass_record(1, "right"),
        play_record(2, "user", [by_id["4-spade"]]),
        play_record(
            3,
            "left",
            [
                by_id["5-spade"],
                by_id["5-heart"],
                by_id["5-club"],
                by_id["5-diamond"],
            ],
            "bomb",
        ),
        pass_record(4, "right"),
        pass_record(5, "user"),
    ]
    return {
        "gameId": "adapter-test",
        "phase": "playing",
        "userSeat": "user",
        "userRole": "farmer",
        "userHand": user_hand,
        "landlord": "left",
        "bottomCards": bottom_cards,
        "currentTurn": "left",
        "trickLeader": "left",
        "currentWinningPlay": None,
        "selectedCards": [],
        "selectedPlay": None,
        "selectedPlayLegal": False,
        "remainingCardCounts": {"user": 16, "left": 15, "right": 17},
        "publicHistory": history,
    }


class StateAdapterTests(unittest.TestCase):
    def test_maps_every_landlord_rotation(self):
        self.assertEqual(
            build_position_map("user"),
            {
                "user": "landlord",
                "left": "landlord_down",
                "right": "landlord_up",
            },
        )
        self.assertEqual(
            build_position_map("left"),
            {
                "left": "landlord",
                "right": "landlord_down",
                "user": "landlord_up",
            },
        )
        self.assertEqual(
            build_position_map("right"),
            {
                "right": "landlord",
                "user": "landlord_down",
                "left": "landlord_up",
            },
        )

    def test_encodes_project_ranks_with_douzero_values(self):
        self.assertEqual(
            [encode_rank(rank) for rank in ["3", "10", "J", "A", "2"]],
            [3, 10, 11, 14, 17],
        )
        self.assertEqual(encode_rank("small_joker"), 20)
        self.assertEqual(encode_rank("big_joker"), 30)
        with self.assertRaisesRegex(ValueError, "unsupported card rank"):
            encode_rank("1")

    def test_builds_douzero_history_and_position_fields(self):
        dto = build_infoset_dto(make_visible_state(), legal_actions=[[6], []])

        self.assertEqual(dto.player_position, "landlord_up")
        self.assertEqual(
            dto.num_cards_left_dict,
            {"landlord_up": 16, "landlord": 15, "landlord_down": 17},
        )
        self.assertEqual(
            dto.card_play_action_seq,
            ((3,), (), (4,), (5, 5, 5, 5), (), ()),
        )
        self.assertEqual(dto.last_move, ())
        self.assertEqual(dto.last_two_moves, ((), ()))
        self.assertEqual(
            dto.last_move_dict,
            {"landlord": (5, 5, 5, 5), "landlord_up": (), "landlord_down": ()},
        )
        self.assertEqual(dto.played_cards["landlord"], (3, 5, 5, 5, 5))
        self.assertEqual(dto.played_cards["landlord_up"], (4,))
        self.assertEqual(dto.played_cards["landlord_down"], ())
        self.assertEqual(dto.last_pid, "landlord")
        self.assertEqual(dto.bomb_num, 1)
        self.assertEqual(dto.legal_actions, ((6,), ()))

    def test_derives_other_cards_only_as_an_unpartitioned_rank_multiset(self):
        state = make_visible_state()
        dto = build_infoset_dto(state)
        played_ranks = [
            encode_rank(card["rank"])
            for record in state["publicHistory"]
            for card in (record["play"] or {}).get("cards", [])
        ]
        hand_ranks = [encode_rank(card["rank"]) for card in state["userHand"]]
        expected = Counter(DOUZERO_DECK) - Counter(played_ranks) - Counter(hand_ranks)

        self.assertEqual(Counter(dto.other_hand_cards), expected)
        self.assertEqual(len(dto.other_hand_cards), 32)
        payload = dto.to_payload()
        serialized_keys = repr(payload)
        self.assertNotIn("all_handcards", serialized_keys)
        self.assertNotIn("hands", payload)
        self.assertNotIn("user", payload["played_cards"])
        self.assertTrue(
            {"card_id", "card_ids", "hands", "all_handcards"}.isdisjoint(payload),
        )

    def test_tracks_current_winning_move_and_reverse_recent_actions(self):
        state = make_visible_state()
        state["publicHistory"] = state["publicHistory"][:2]
        state["remainingCardCounts"] = {"user": 16, "left": 19, "right": 17}
        state["currentTurn"] = "user"
        state["currentWinningPlay"] = deepcopy(
            state["publicHistory"][0]["play"],
        )
        state["trickLeader"] = "left"
        # Add the previously played user card back so the visible totals remain valid.
        deck_by_id = {card["id"]: card for card in make_deck()}
        state["userHand"].append(deck_by_id["4-spade"])
        state["remainingCardCounts"]["user"] = 17

        dto = build_infoset_dto(state)

        self.assertEqual(dto.last_move, (3,))
        self.assertEqual(dto.last_two_moves, ((), (3,)))
        self.assertEqual(dto.last_move_dict["landlord"], (3,))
        self.assertEqual(dto.last_move_dict["landlord_down"], ())

    def test_rejects_hidden_fields_and_inconsistent_visible_state(self):
        state = make_visible_state()
        state["hands"] = {"left": []}
        with self.assertRaisesRegex(ValueError, "forbidden hidden fields"):
            build_infoset_dto(state)

        state = make_visible_state()
        state["remainingCardCounts"]["right"] = 16
        with self.assertRaisesRegex(ValueError, "inconsistent"):
            build_infoset_dto(state)

        state = make_visible_state()
        state["phase"] = "bidding"
        with self.assertRaisesRegex(ValueError, "playing phase"):
            build_infoset_dto(state)

    def test_returns_detached_mutable_infoset_for_upstream_encoder(self):
        dto = build_infoset_dto(make_visible_state(), legal_actions=[[6], []])
        infoset = dto.to_infoset()
        infoset.player_hand_cards.pop()
        infoset.played_cards["landlord"].append(30)

        self.assertEqual(len(dto.player_hand_cards), 16)
        self.assertNotIn(30, dto.played_cards["landlord"])


if __name__ == "__main__":
    unittest.main()
