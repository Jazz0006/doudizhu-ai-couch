from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest


SOURCE_ROOT = Path(__file__).parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from douzero_inference import verify_model_manifest


class ModelManifestTests(unittest.TestCase):
    def test_verifies_all_files_and_requires_explicit_unapproved_opt_in(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = self._write_fixture(root, approved=False)
            with self.assertRaisesRegex(ValueError, "not approved"):
                verify_model_manifest(manifest_path, root)

            verified = verify_model_manifest(
                manifest_path,
                root,
                allow_unapproved=True,
            )
            self.assertEqual(verified.objective, "wp")
            self.assertEqual(set(verified.model_paths), {
                "landlord",
                "landlord_up",
                "landlord_down",
            })

    def test_rejects_tampered_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = self._write_fixture(root, approved=True)
            (root / "landlord.ckpt").write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "sha256 mismatch"):
                verify_model_manifest(manifest_path, root)

    @staticmethod
    def _write_fixture(root: Path, *, approved: bool) -> Path:
        models = {}
        for position in ("landlord", "landlord_up", "landlord_down"):
            content = position.encode("ascii")
            filename = f"{position}.ckpt"
            (root / filename).write_bytes(content)
            models[position] = {
                "filename": filename,
                "sizeBytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        manifest = {
            "schemaVersion": 1,
            "modelVersion": "fixture-v1",
            "objective": "wp",
            "approvedForProduction": approved,
            "models": models,
        }
        path = root / "manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path


if __name__ == "__main__":
    unittest.main()
