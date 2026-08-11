from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from types import SimpleNamespace
from typing import Any, Literal, Mapping, Sequence


Seat = Literal["user", "left", "right"]
Position = Literal["landlord", "landlord_up", "landlord_down"]

SEATS: tuple[Seat, ...] = ("user", "left", "right")
POSITIONS: tuple[Position, ...] = (
    "landlord",
    "landlord_up",
    "landlord_down",
)
RANK_TO_DOUZERO: Mapping[str, int] = {
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
    "J": 11,
    "Q": 12,
    "K": 13,
    "A": 14,
    "2": 17,
    "small_joker": 20,
    "big_joker": 30,
}
DOUZERO_DECK = tuple(
    sorted(
        [rank for rank in range(3, 15) for _ in range(4)]
        + [17, 17, 17, 17, 20, 30]
    )
)
FORBIDDEN_STATE_FIELDS = frozenset(
    {
        "hands",
        "all_handcards",
        "initialHands",
        "randomSeed",
        "biddingHistory",
    }
)


@dataclass(frozen=True)
class DouZeroInfoSetDTO:
    player_position: Position
    player_hand_cards: tuple[int, ...]
    num_cards_left_dict: dict[Position, int]
    three_landlord_cards: tuple[int, ...]
    card_play_action_seq: tuple[tuple[int, ...], ...]
    other_hand_cards: tuple[int, ...]
    legal_actions: tuple[tuple[int, ...], ...]
    last_move: tuple[int, ...]
    last_two_moves: tuple[tuple[int, ...], tuple[int, ...]]
    last_move_dict: dict[Position, tuple[int, ...]]
    played_cards: dict[Position, tuple[int, ...]]
    last_pid: Position
    bomb_num: int

    def to_payload(self) -> dict[str, Any]:
        """Return a JSON-safe payload without physical card IDs or hidden hands."""
        return asdict(self)

    def to_infoset(self) -> SimpleNamespace:
        """Create the mutable attribute container expected by DouZero get_obs()."""
        return SimpleNamespace(
            player_position=self.player_position,
            player_hand_cards=list(self.player_hand_cards),
            num_cards_left_dict=dict(self.num_cards_left_dict),
            three_landlord_cards=list(self.three_landlord_cards),
            card_play_action_seq=[
                list(action) for action in self.card_play_action_seq
            ],
            other_hand_cards=list(self.other_hand_cards),
            legal_actions=[list(action) for action in self.legal_actions],
            last_move=list(self.last_move),
            last_two_moves=[list(action) for action in self.last_two_moves],
            last_move_dict={
                position: list(action)
                for position, action in self.last_move_dict.items()
            },
            played_cards={
                position: list(cards)
                for position, cards in self.played_cards.items()
            },
            last_pid=self.last_pid,
            bomb_num=self.bomb_num,
        )


def build_infoset_dto(
    state: Mapping[str, Any],
    legal_actions: Sequence[Sequence[int]] = (),
) -> DouZeroInfoSetDTO:
    """Convert a validated player-visible state into DouZero observation state."""
    _reject_forbidden_fields(state)
    if state.get("phase") != "playing":
        raise ValueError("DouZero inference requires the playing phase")

    viewer = _parse_seat(state.get("userSeat"), "userSeat")
    landlord = _parse_seat(state.get("landlord"), "landlord")
    seat_to_position = build_position_map(landlord)
    player_position = seat_to_position[viewer]

    user_hand_cards, user_hand_ids = _parse_cards(
        state.get("userHand"),
        "userHand",
    )
    bottom_cards, bottom_card_ids = _parse_cards(
        state.get("bottomCards"),
        "bottomCards",
    )
    if len(bottom_cards) != 3:
        raise ValueError("bottomCards must contain three public cards while playing")

    remaining_counts = _parse_remaining_counts(state.get("remainingCardCounts"))
    if remaining_counts[viewer] != len(user_hand_cards):
        raise ValueError("viewer hand length does not match remainingCardCounts")

    history = _parse_history(state.get("publicHistory"), seat_to_position)
    played_counter = Counter(
        card
        for record in history
        for card in record["cards"]
    )
    visible_counter = Counter(user_hand_cards) + played_counter
    deck_counter = Counter(DOUZERO_DECK)
    if visible_counter - deck_counter:
        raise ValueError("visible cards exceed the standard DouDizhu deck")

    other_hand_counter = deck_counter - visible_counter
    expected_other_count = sum(
        count for seat, count in remaining_counts.items() if seat != viewer
    )
    if sum(other_hand_counter.values()) != expected_other_count:
        raise ValueError("public history and remaining card counts are inconsistent")

    history_ids = {
        card_id
        for record in history
        for card_id in record["card_ids"]
    }
    if user_hand_ids & history_ids:
        raise ValueError("a physical card cannot be both held and already played")

    action_sequence = tuple(record["cards"] for record in history)
    played_cards: dict[Position, list[int]] = {
        position: [] for position in POSITIONS
    }
    last_move_dict: dict[Position, tuple[int, ...]] = {
        position: () for position in POSITIONS
    }
    bomb_num = 0
    for record in history:
        position = record["position"]
        cards = record["cards"]
        last_move_dict[position] = cards
        played_cards[position].extend(cards)
        if record["play_type"] in {"bomb", "rocket"}:
            bomb_num += 1

    current_winning_play = state.get("currentWinningPlay")
    last_move = _parse_nullable_play_cards(
        current_winning_play,
        "currentWinningPlay",
    )
    last_two_moves = tuple(reversed(action_sequence[-2:]))
    last_two_moves = last_two_moves + ((),) * (2 - len(last_two_moves))

    trick_leader_value = state.get("trickLeader")
    if trick_leader_value is None:
        last_pid = seat_to_position[landlord]
    else:
        last_pid = seat_to_position[
            _parse_seat(trick_leader_value, "trickLeader")
        ]

    remaining_bottom_ids = bottom_card_ids - history_ids
    remaining_bottom_cards = tuple(
        card
        for card, card_id in zip(bottom_cards, _ordered_card_ids(state["bottomCards"]))
        if card_id in remaining_bottom_ids
    )

    normalized_legal_actions = tuple(
        tuple(sorted(_parse_douzero_action(action))) for action in legal_actions
    )

    return DouZeroInfoSetDTO(
        player_position=player_position,
        player_hand_cards=tuple(sorted(user_hand_cards)),
        num_cards_left_dict={
            seat_to_position[seat]: count
            for seat, count in remaining_counts.items()
        },
        three_landlord_cards=tuple(sorted(remaining_bottom_cards)),
        card_play_action_seq=action_sequence,
        other_hand_cards=tuple(sorted(other_hand_counter.elements())),
        legal_actions=normalized_legal_actions,
        last_move=last_move,
        last_two_moves=(last_two_moves[0], last_two_moves[1]),
        last_move_dict=last_move_dict,
        played_cards={
            position: tuple(sorted(cards))
            for position, cards in played_cards.items()
        },
        last_pid=last_pid,
        bomb_num=bomb_num,
    )


def build_position_map(landlord: Seat) -> dict[Seat, Position]:
    landlord_index = SEATS.index(landlord)
    landlord_down = SEATS[(landlord_index + 1) % len(SEATS)]
    landlord_up = SEATS[(landlord_index + 2) % len(SEATS)]
    return {
        landlord: "landlord",
        landlord_down: "landlord_down",
        landlord_up: "landlord_up",
    }


def encode_rank(rank: str) -> int:
    try:
        return RANK_TO_DOUZERO[rank]
    except KeyError as error:
        raise ValueError(f"unsupported card rank: {rank!r}") from error


def _reject_forbidden_fields(state: Mapping[str, Any]) -> None:
    present = FORBIDDEN_STATE_FIELDS.intersection(state)
    if present:
        names = ", ".join(sorted(present))
        raise ValueError(f"state contains forbidden hidden fields: {names}")


def _parse_seat(value: Any, field: str) -> Seat:
    if value not in SEATS:
        raise ValueError(f"{field} must be a playing seat")
    return value


def _parse_cards(value: Any, field: str) -> tuple[list[int], set[str]]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    ranks: list[int] = []
    card_ids: set[str] = set()
    for index, card in enumerate(value):
        if not isinstance(card, Mapping):
            raise ValueError(f"{field}[{index}] must be a card object")
        card_id = card.get("id")
        rank = card.get("rank")
        if not isinstance(card_id, str) or not card_id:
            raise ValueError(f"{field}[{index}].id must be a non-empty string")
        if card_id in card_ids:
            raise ValueError(f"{field} contains duplicate physical card IDs")
        if not isinstance(rank, str):
            raise ValueError(f"{field}[{index}].rank must be a string")
        card_ids.add(card_id)
        ranks.append(encode_rank(rank))
    return ranks, card_ids


def _ordered_card_ids(value: Any) -> list[str]:
    return [card["id"] for card in value]


def _parse_remaining_counts(value: Any) -> dict[Seat, int]:
    if not isinstance(value, Mapping):
        raise ValueError("remainingCardCounts must be an object")
    result: dict[Seat, int] = {}
    for seat in SEATS:
        count = value.get(seat)
        if not isinstance(count, int) or isinstance(count, bool) or not 0 <= count <= 20:
            raise ValueError(f"remainingCardCounts.{seat} is invalid")
        result[seat] = count
    return result


def _parse_history(
    value: Any,
    seat_to_position: Mapping[Seat, Position],
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("publicHistory must be an array")
    records: list[dict[str, Any]] = []
    seen_card_ids: set[str] = set()
    for index, record in enumerate(value):
        if not isinstance(record, Mapping):
            raise ValueError(f"publicHistory[{index}] must be an object")
        seat = _parse_seat(record.get("seat"), f"publicHistory[{index}].seat")
        action = record.get("action")
        play = record.get("play")
        if action == "pass":
            if play is not None:
                raise ValueError(f"publicHistory[{index}] pass must not contain a play")
            cards: tuple[int, ...] = ()
            card_ids: set[str] = set()
            play_type = None
        elif action == "play" and isinstance(play, Mapping):
            parsed_cards, card_ids = _parse_cards(
                play.get("cards"),
                f"publicHistory[{index}].play.cards",
            )
            cards = tuple(sorted(parsed_cards))
            play_type = play.get("type")
            if not isinstance(play_type, str):
                raise ValueError(f"publicHistory[{index}].play.type is invalid")
        else:
            raise ValueError(f"publicHistory[{index}] action is invalid")
        if seen_card_ids & card_ids:
            raise ValueError("publicHistory repeats a physical card ID")
        seen_card_ids.update(card_ids)
        records.append(
            {
                "position": seat_to_position[seat],
                "cards": cards,
                "card_ids": card_ids,
                "play_type": play_type,
            }
        )
    return records


def _parse_nullable_play_cards(value: Any, field: str) -> tuple[int, ...]:
    if value is None:
        return ()
    if not isinstance(value, Mapping):
        raise ValueError(f"{field} must be a play object or null")
    cards, _ = _parse_cards(value.get("cards"), f"{field}.cards")
    return tuple(sorted(cards))


def _parse_douzero_action(action: Sequence[int]) -> list[int]:
    if isinstance(action, (str, bytes)):
        raise ValueError("legal actions must be integer sequences")
    result = list(action)
    if not all(
        isinstance(card, int)
        and not isinstance(card, bool)
        and card in DOUZERO_DECK
        for card in result
    ):
        raise ValueError("legal actions contain an unsupported DouZero card")
    return result
