from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Mapping, Protocol


SOURCE_ROOT = Path(__file__).parent / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from douzero_inference import (  # noqa: E402
    RankedDeepAgent,
    RankedModelAction,
    build_rankable_infoset,
    rank_action_values,
    verify_model_manifest,
)


class ModelBackend(Protocol):
    model_version: str
    objective: str
    source: str

    def rank(self, position: str, infoset, top_k: int): ...


class FakeBackend:
    model_version = "fake-deterministic-v1"
    objective = "adp"
    source = "test"

    def __init__(self, delay_ms: int = 0):
        self.delay_ms = delay_ms

    def rank(self, _position: str, infoset, top_k: int):
        if self.delay_ms:
            time.sleep(self.delay_ms / 1000)
        values = [
            _fake_action_value(action)
            for action in infoset.legal_actions
        ]
        return rank_action_values(infoset.legal_actions, values, top_k)


class DouZeroBackend:
    source = "douzero"

    def __init__(self, args: argparse.Namespace):
        if args.upstream_path:
            upstream_path = Path(args.upstream_path).resolve()
            if not (upstream_path / "douzero").is_dir():
                raise ValueError("upstream path does not contain the douzero package")
            sys.path.insert(0, str(upstream_path))
        if args.model_manifest:
            if not args.models_dir:
                raise ValueError("--models-dir is required with --model-manifest")
            manifest = verify_model_manifest(
                args.model_manifest,
                args.models_dir,
                allow_unapproved=args.allow_unapproved_models,
            )
            self.objective = manifest.objective
            self.model_version = manifest.model_version
            model_paths = manifest.model_paths
        else:
            self.objective = args.objective
            self.model_version = args.model_version
            model_paths = {
                "landlord": args.landlord_model,
                "landlord_up": args.landlord_up_model,
                "landlord_down": args.landlord_down_model,
            }
        missing = [position for position, path in model_paths.items() if not path]
        if missing:
            raise ValueError(
                "missing model paths for: " + ", ".join(sorted(missing)),
            )
        self.agents = {
            position: RankedDeepAgent(position, path)
            for position, path in model_paths.items()
        }

    def rank(self, position: str, infoset, top_k: int):
        return self.agents[position].get_ranked_actions(infoset, top_k)


def main() -> int:
    args = _parse_args()
    try:
        backend: ModelBackend = (
            FakeBackend(args.delay_ms)
            if args.backend == "fake"
            else DouZeroBackend(args)
        )
    except Exception as error:
        _log(f"worker_start_failed: {type(error).__name__}: {error}")
        return 1

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        request_id: str | None = None
        should_stop = False
        try:
            request = json.loads(line)
            request_id, method, params = _parse_request(request)
            if method == "ping":
                result = {
                    "backend": backend.source,
                    "modelVersion": backend.model_version,
                    "objective": backend.objective,
                    "processId": os.getpid(),
                }
            elif method == "rank_actions":
                result = _rank_actions(backend, params)
            elif method == "shutdown":
                result = {"stopped": True}
                should_stop = True
            else:
                raise WorkerRequestError("unsupported_method", "Unsupported method")
            _write_response({"id": request_id, "ok": True, "result": result})
        except WorkerRequestError as error:
            _write_response(
                {
                    "id": request_id,
                    "ok": False,
                    "error": {"code": error.code, "message": str(error)},
                },
            )
        except Exception as error:
            _log(f"request_failed: {type(error).__name__}: {error}")
            _write_response(
                {
                    "id": request_id,
                    "ok": False,
                    "error": {
                        "code": "inference_error",
                        "message": str(error),
                    },
                },
            )
        if should_stop:
            break
    return 0


class WorkerRequestError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _rank_actions(backend: ModelBackend, params: Mapping[str, Any]) -> dict[str, Any]:
    state = params.get("state")
    legal_actions = params.get("legalActions")
    state_ref = params.get("stateRef")
    top_k = params.get("topK", 5)
    if not isinstance(state, Mapping):
        raise WorkerRequestError("invalid_request", "state must be an object")
    if not isinstance(legal_actions, list):
        raise WorkerRequestError(
            "invalid_request",
            "legalActions must be an array",
        )
    if not legal_actions:
        raise WorkerRequestError("invalid_request", "legalActions must not be empty")
    if not isinstance(state_ref, Mapping):
        raise WorkerRequestError("invalid_request", "stateRef must be an object")
    if not isinstance(top_k, int) or isinstance(top_k, bool) or not 1 <= top_k <= 20:
        raise WorkerRequestError("invalid_request", "topK must be between 1 and 20")
    _validate_state_ref(state, state_ref)
    if state.get("currentTurn") != state.get("userSeat"):
        raise WorkerRequestError(
            "not_applicable",
            "rank_actions requires the visible player's turn",
        )

    started = time.perf_counter()
    try:
        rankable = build_rankable_infoset(state, legal_actions)
    except ValueError as error:
        raise WorkerRequestError("invalid_request", str(error)) from error
    ranked: list[RankedModelAction[list[int]]] = backend.rank(
        rankable.infoset.player_position,
        rankable.infoset.to_infoset(),
        top_k,
    )
    best_value = ranked[0].value if ranked else None
    actions = []
    for rank, model_action in enumerate(ranked, start=1):
        canonical = rankable.action_set.action_at_model_index(
            model_action.original_index,
        )
        actions.append(
            {
                "rank": rank,
                "actionId": canonical.action_id,
                "equivalentActionIds": list(canonical.equivalent_action_ids),
                "signature": canonical.signature,
                "modelScore": model_action.value,
                "deltaFromBest": (
                    None
                    if best_value is None or model_action.value is None
                    else model_action.value - best_value
                ),
            },
        )

    return {
        "stateRef": dict(state_ref),
        "position": rankable.infoset.player_position,
        "modelVersion": backend.model_version,
        "objective": backend.objective,
        "source": backend.source,
        "actions": actions,
        "latencyMs": round((time.perf_counter() - started) * 1000, 3),
    }


def _validate_state_ref(
    state: Mapping[str, Any],
    state_ref: Mapping[str, Any],
) -> None:
    game_id = state_ref.get("gameId")
    revision = state_ref.get("revision")
    action_index = state_ref.get("actionIndex")
    checksum = state_ref.get("stateChecksum")
    if not isinstance(game_id, str) or not game_id:
        raise WorkerRequestError("invalid_request", "stateRef.gameId is invalid")
    if game_id != state.get("gameId"):
        raise WorkerRequestError("state_mismatch", "stateRef.gameId does not match state")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise WorkerRequestError("invalid_request", "stateRef.revision is invalid")
    history = state.get("publicHistory")
    if (
        not isinstance(action_index, int)
        or isinstance(action_index, bool)
        or action_index < 0
        or not isinstance(history, list)
        or action_index != len(history)
    ):
        raise WorkerRequestError(
            "state_mismatch",
            "stateRef.actionIndex does not match publicHistory",
        )
    if not isinstance(checksum, str) or not checksum:
        raise WorkerRequestError("invalid_request", "stateRef.stateChecksum is invalid")


def _parse_request(
    value: Any,
) -> tuple[str, str, Mapping[str, Any]]:
    if not isinstance(value, Mapping):
        raise WorkerRequestError("invalid_request", "request must be an object")
    request_id = value.get("id")
    method = value.get("method")
    params = value.get("params", {})
    if not isinstance(request_id, str) or not request_id:
        raise WorkerRequestError("invalid_request", "request id is invalid")
    if not isinstance(method, str) or not method:
        raise WorkerRequestError("invalid_request", "request method is invalid")
    if not isinstance(params, Mapping):
        raise WorkerRequestError("invalid_request", "request params must be an object")
    return request_id, method, params


def _fake_action_value(action: list[int]) -> float:
    if not action:
        return -10_000.0
    return float(len(action) * 100 - sum(action))


def _write_response(response: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _log(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("douzero", "fake"), default="douzero")
    parser.add_argument("--objective", choices=("adp", "wp"), default="adp")
    parser.add_argument("--model-version", default="douzero-unconfigured")
    parser.add_argument("--upstream-path")
    parser.add_argument("--model-manifest")
    parser.add_argument("--models-dir")
    parser.add_argument("--allow-unapproved-models", action="store_true")
    parser.add_argument("--landlord-model")
    parser.add_argument("--landlord-up-model")
    parser.add_argument("--landlord-down-model")
    parser.add_argument("--delay-ms", type=int, default=0)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
