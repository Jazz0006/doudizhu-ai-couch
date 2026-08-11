from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Generic, Sequence, TypeVar


ActionT = TypeVar("ActionT")


@dataclass(frozen=True)
class RankedModelAction(Generic[ActionT]):
    action: ActionT
    value: float | None
    original_index: int


def rank_action_values(
    legal_actions: Sequence[ActionT],
    values: Sequence[float],
    top_k: int = 5,
) -> list[RankedModelAction[ActionT]]:
    """Rank actions by model value while preserving upstream argmax ties."""
    if not isinstance(top_k, int) or isinstance(top_k, bool) or top_k < 1:
        raise ValueError("top_k must be a positive integer")
    if len(legal_actions) != len(values):
        raise ValueError("legal_actions and values must have the same length")
    if not legal_actions:
        return []

    normalized_values = [float(value) for value in values]
    if not all(math.isfinite(value) for value in normalized_values):
        raise ValueError("model values must all be finite")

    # NumPy argmax returns the first maximum. The original index is therefore
    # the deterministic tie-breaker needed to preserve DeepAgent.act() Top-1.
    ranked_indices = sorted(
        range(len(legal_actions)),
        key=lambda index: (-normalized_values[index], index),
    )[: min(top_k, len(legal_actions))]

    return [
        RankedModelAction(
            action=legal_actions[index],
            value=normalized_values[index],
            original_index=index,
        )
        for index in ranked_indices
    ]


class RankedDeepAgent:
    """Thin Top-K extension of DouZero's official evaluation DeepAgent."""

    def __init__(self, position: str, model_path: str | Path):
        # Keep imports lazy so pure ranking and protocol tests do not require
        # PyTorch. The isolated inference runtime supplies these dependencies.
        import torch
        from douzero.dmc.models import model_dict

        model = model_dict[position]()
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        pretrained = torch.load(
            str(model_path),
            map_location=device,
            weights_only=True,
        )
        if not isinstance(pretrained, dict):
            raise ValueError("DouZero checkpoint must contain a state dictionary")
        model_state = model.state_dict()
        model_state.update(
            {key: value for key, value in pretrained.items() if key in model_state},
        )
        model.load_state_dict(model_state)
        if torch.cuda.is_available():
            model.cuda()
        model.eval()
        self.model = model

    def act(self, infoset):
        """Return exactly the first action from the ranked inference result."""
        return self.get_ranked_actions(infoset, top_k=1)[0].action

    def get_ranked_actions(
        self,
        infoset,
        top_k: int = 5,
    ) -> list[RankedModelAction[list[int]]]:
        legal_actions = infoset.legal_actions
        if not isinstance(top_k, int) or isinstance(top_k, bool) or top_k < 1:
            raise ValueError("top_k must be a positive integer")
        if len(legal_actions) == 0:
            return []
        if len(legal_actions) == 1:
            return [
                RankedModelAction(
                    action=legal_actions[0],
                    value=None,
                    original_index=0,
                )
            ]

        import torch
        from douzero.env.env import get_obs

        obs = get_obs(infoset)
        z_batch = torch.from_numpy(obs["z_batch"]).float()
        x_batch = torch.from_numpy(obs["x_batch"]).float()
        if torch.cuda.is_available():
            z_batch = z_batch.cuda()
            x_batch = x_batch.cuda()

        with torch.inference_mode():
            prediction = self.model.forward(
                z_batch,
                x_batch,
                return_value=True,
            )["values"]
        values = prediction.detach().cpu().numpy().reshape(-1).tolist()
        return rank_action_values(legal_actions, values, top_k)
