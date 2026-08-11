from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .state_adapter import DouZeroInfoSetDTO, build_infoset_dto, encode_rank


@dataclass(frozen=True)
class CanonicalLegalAction:
    signature: str
    action_id: str
    equivalent_action_ids: tuple[str, ...]
    douzero_action: tuple[int, ...]
    play_type: str | None


@dataclass(frozen=True)
class CanonicalActionSet:
    actions: tuple[CanonicalLegalAction, ...]

    @property
    def douzero_actions(self) -> tuple[tuple[int, ...], ...]:
        return tuple(action.douzero_action for action in self.actions)

    def action_at_model_index(self, index: int) -> CanonicalLegalAction:
        if not isinstance(index, int) or isinstance(index, bool):
            raise TypeError("model action index must be an integer")
        if index < 0:
            raise IndexError("model action index is out of range")
        try:
            return self.actions[index]
        except IndexError as error:
            raise IndexError("model action index is out of range") from error


@dataclass(frozen=True)
class RankableInfoSet:
    infoset: DouZeroInfoSetDTO
    action_set: CanonicalActionSet


def build_rankable_infoset(
    state: Mapping[str, Any],
    public_legal_actions: Sequence[Mapping[str, Any]],
) -> RankableInfoSet:
    """Build one canonical model action per project-rule semantic action."""
    provisional_infoset = build_infoset_dto(state)
    action_set = canonicalize_legal_actions(
        public_legal_actions,
        provisional_infoset.player_hand_cards,
    )
    infoset = build_infoset_dto(state, action_set.douzero_actions)
    return RankableInfoSet(infoset=infoset, action_set=action_set)


def canonicalize_legal_actions(
    public_legal_actions: Sequence[Mapping[str, Any]],
    player_hand_cards: Sequence[int],
) -> CanonicalActionSet:
    """Collapse physical-card variants into deterministic rank-multiset actions."""
    hand_counter = Counter(player_hand_cards)
    seen_action_ids: set[str] = set()
    groups: dict[
        tuple[int, ...] | None,
        list[tuple[str, str | None]],
    ] = {}

    for index, action in enumerate(public_legal_actions):
        if not isinstance(action, Mapping):
            raise ValueError(f"legalActions[{index}] must be an object")
        action_id = action.get("actionId")
        if not isinstance(action_id, str) or not action_id:
            raise ValueError(f"legalActions[{index}].actionId is invalid")
        if action_id in seen_action_ids:
            raise ValueError(f"duplicate legal action ID: {action_id}")
        seen_action_ids.add(action_id)

        action_type = action.get("action")
        if action_type == "pass":
            _validate_pass_action(action, index)
            semantic_key: tuple[int, ...] | None = None
            play_type: str | None = None
        elif action_type == "play":
            semantic_key, play_type = _parse_play_action(action, index)
            if not semantic_key:
                raise ValueError("play actions must contain at least one card")
            if Counter(semantic_key) - hand_counter:
                raise ValueError(
                    f"legalActions[{index}] contains cards outside the player hand",
                )
        else:
            raise ValueError(f"legalActions[{index}].action is invalid")

        groups.setdefault(semantic_key, []).append((action_id, play_type))

    canonical_actions: list[CanonicalLegalAction] = []
    for semantic_key, equivalents in groups.items():
        play_types = {play_type for _, play_type in equivalents}
        if len(play_types) != 1:
            raise ValueError("equivalent rank actions disagree on play type")
        equivalent_ids = tuple(sorted(action_id for action_id, _ in equivalents))
        play_type = next(iter(play_types))
        if semantic_key is None:
            canonical_actions.append(
                CanonicalLegalAction(
                    signature="pass",
                    action_id=equivalent_ids[0],
                    equivalent_action_ids=equivalent_ids,
                    douzero_action=(),
                    play_type=None,
                ),
            )
        else:
            canonical_actions.append(
                CanonicalLegalAction(
                    signature=_rank_signature(semantic_key),
                    action_id=equivalent_ids[0],
                    equivalent_action_ids=equivalent_ids,
                    douzero_action=semantic_key,
                    play_type=play_type,
                ),
            )

    canonical_actions.sort(
        key=lambda action: (
            action.douzero_action == (),
            action.douzero_action,
            action.action_id,
        ),
    )
    return CanonicalActionSet(actions=tuple(canonical_actions))


def _validate_pass_action(action: Mapping[str, Any], index: int) -> None:
    if action.get("actionId") != "pass":
        raise ValueError(f"legalActions[{index}] pass actionId must be 'pass'")
    if action.get("cards") != [] or action.get("play") is not None:
        raise ValueError(f"legalActions[{index}] pass payload is invalid")


def _parse_play_action(
    action: Mapping[str, Any],
    index: int,
) -> tuple[tuple[int, ...], str]:
    cards, card_ids = _parse_public_cards(
        action.get("cards"),
        f"legalActions[{index}].cards",
    )
    expected_action_id = f"play:{','.join(sorted(card_ids))}"
    if action.get("actionId") != expected_action_id:
        raise ValueError(f"legalActions[{index}].actionId disagrees with cards")
    play = action.get("play")
    if not isinstance(play, Mapping):
        raise ValueError(f"legalActions[{index}].play is invalid")
    play_cards, play_card_ids = _parse_public_cards(
        play.get("cards"),
        f"legalActions[{index}].play.cards",
    )
    if card_ids != play_card_ids or Counter(cards) != Counter(play_cards):
        raise ValueError(f"legalActions[{index}] cards disagree with play.cards")
    play_type = play.get("type")
    if not isinstance(play_type, str) or not play_type:
        raise ValueError(f"legalActions[{index}].play.type is invalid")
    return tuple(sorted(cards)), play_type


def _parse_public_cards(
    value: Any,
    field: str,
) -> tuple[list[int], set[str]]:
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
            raise ValueError(f"{field}[{index}].id is invalid")
        if card_id in card_ids:
            raise ValueError(f"{field} contains duplicate physical card IDs")
        if not isinstance(rank, str):
            raise ValueError(f"{field}[{index}].rank is invalid")
        card_ids.add(card_id)
        ranks.append(encode_rank(rank))
    return ranks, card_ids


def _rank_signature(action: Sequence[int]) -> str:
    counts = Counter(action)
    return "play:" + ",".join(
        f"{rank}x{counts[rank]}" for rank in sorted(counts)
    )
