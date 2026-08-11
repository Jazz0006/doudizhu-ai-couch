from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Mapping


POSITIONS = ("landlord", "landlord_up", "landlord_down")


@dataclass(frozen=True)
class VerifiedModelManifest:
    model_version: str
    objective: str
    approved_for_production: bool
    model_paths: Mapping[str, Path]


def verify_model_manifest(
    manifest_path: str | Path,
    models_dir: str | Path,
    *,
    allow_unapproved: bool = False,
) -> VerifiedModelManifest:
    manifest_file = Path(manifest_path).resolve()
    model_root = Path(models_dir).resolve()
    try:
        data = json.loads(manifest_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"unable to read model manifest: {error}") from error
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise ValueError("model manifest schemaVersion must be 1")

    model_version = data.get("modelVersion")
    objective = data.get("objective")
    approved = data.get("approvedForProduction")
    models = data.get("models")
    if not isinstance(model_version, str) or not model_version:
        raise ValueError("model manifest modelVersion is invalid")
    if objective not in ("adp", "wp"):
        raise ValueError("model manifest objective must be adp or wp")
    if not isinstance(approved, bool):
        raise ValueError("model manifest approvedForProduction must be boolean")
    if not approved and not allow_unapproved:
        raise ValueError("model manifest is not approved for production")
    if not isinstance(models, dict) or set(models) != set(POSITIONS):
        raise ValueError("model manifest must contain exactly three positions")

    verified_paths: dict[str, Path] = {}
    for position in POSITIONS:
        entry = models[position]
        if not isinstance(entry, dict):
            raise ValueError(f"model manifest entry {position} is invalid")
        filename = entry.get("filename")
        size_bytes = entry.get("sizeBytes")
        sha256 = entry.get("sha256")
        if (
            not isinstance(filename, str)
            or not filename
            or Path(filename).name != filename
        ):
            raise ValueError(f"model manifest filename for {position} is invalid")
        if (
            not isinstance(size_bytes, int)
            or isinstance(size_bytes, bool)
            or size_bytes < 1
        ):
            raise ValueError(f"model manifest size for {position} is invalid")
        if (
            not isinstance(sha256, str)
            or len(sha256) != 64
            or any(character not in "0123456789abcdef" for character in sha256)
        ):
            raise ValueError(f"model manifest sha256 for {position} is invalid")

        model_path = (model_root / filename).resolve()
        if model_path.parent != model_root:
            raise ValueError(f"model path for {position} escapes models directory")
        try:
            actual_size = model_path.stat().st_size
        except OSError as error:
            raise ValueError(f"model file for {position} is unavailable: {error}") from error
        if actual_size != size_bytes:
            raise ValueError(f"model file size mismatch for {position}")
        if _sha256(model_path) != sha256:
            raise ValueError(f"model file sha256 mismatch for {position}")
        verified_paths[position] = model_path

    return VerifiedModelManifest(
        model_version=model_version,
        objective=objective,
        approved_for_production=approved,
        model_paths=verified_paths,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
