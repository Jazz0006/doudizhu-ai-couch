from __future__ import annotations

import ast
from contextlib import nullcontext
from dataclasses import fields
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


SOURCE_ROOT = Path(__file__).parents[1] / "src"
sys.path.insert(0, str(SOURCE_ROOT))

from douzero_inference import DouZeroInfoSetDTO, RankedDeepAgent


class _FakeArray:
    def __init__(self, values):
        self.values = [[float(value)] for value in values]

    def reshape(self, *_shape):
        return self

    def tolist(self):
        return [row[0] for row in self.values]


class _FakeTensor:
    def __init__(self, values=None):
        self.values = values

    def float(self):
        return self

    def cuda(self):
        return self

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return _FakeArray(self.values)


class _FakeModel:
    def __init__(self, values):
        self.values = values

    def forward(self, *_args, **_kwargs):
        return {"values": _FakeTensor(self.values)}


def _fake_modules():
    torch = ModuleType("torch")
    torch.cuda = SimpleNamespace(is_available=lambda: False)
    torch.from_numpy = lambda value: _FakeTensor(value)
    torch.inference_mode = nullcontext

    numpy = ModuleType("numpy")

    def argmax(array, axis=0):
        if axis != 0:
            raise AssertionError("Unexpected argmax axis")
        values = [row[0] for row in array.values]
        return [max(range(len(values)), key=lambda index: values[index])]

    numpy.argmax = argmax

    douzero = ModuleType("douzero")
    douzero.__path__ = []
    env_package = ModuleType("douzero.env")
    env_package.__path__ = []
    env_module = ModuleType("douzero.env.env")
    env_module.get_obs = lambda _infoset: {
        "z_batch": [],
        "x_batch": [],
    }
    return {
        "torch": torch,
        "numpy": numpy,
        "douzero": douzero,
        "douzero.env": env_package,
        "douzero.env.env": env_module,
    }


class UpstreamParityTests(unittest.TestCase):
    def setUp(self):
        upstream_root_value = os.environ.get("DOUZERO_UPSTREAM_PATH")
        if not upstream_root_value:
            self.skipTest("DOUZERO_UPSTREAM_PATH is not set")
        self.upstream_root = Path(upstream_root_value)
        lock_path = Path(__file__).parents[1] / "upstream.lock.json"
        locked_commit = json.loads(lock_path.read_text(encoding="utf-8"))["commit"]
        actual_commit = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={self.upstream_root.as_posix()}",
                "-C",
                str(self.upstream_root),
                "rev-parse",
                "HEAD",
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(actual_commit, locked_commit)

    def test_ranked_top_one_matches_pinned_upstream_deep_agent(self):
        deep_agent_path = (
            self.upstream_root / "douzero" / "evaluation" / "deep_agent.py"
        )
        if not deep_agent_path.is_file():
            self.fail(f"Pinned upstream deep_agent.py not found at {deep_agent_path}")

        modules = _fake_modules()
        with patch.dict(sys.modules, modules):
            spec = importlib.util.spec_from_file_location(
                "pinned_douzero_deep_agent",
                deep_agent_path,
            )
            if spec is None or spec.loader is None:
                self.fail("Unable to load pinned upstream DeepAgent")
            upstream_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(upstream_module)

            for values in ([0.1, 0.9, 0.3], [2.0, 2.0, -1.0]):
                with self.subTest(values=values):
                    infoset = SimpleNamespace(
                        legal_actions=[[3], [4, 4], []],
                    )
                    upstream = upstream_module.DeepAgent.__new__(
                        upstream_module.DeepAgent,
                    )
                    upstream.model = _FakeModel(values)
                    ranked = RankedDeepAgent.__new__(RankedDeepAgent)
                    ranked.model = _FakeModel(values)

                    self.assertEqual(
                        ranked.get_ranked_actions(infoset, top_k=1)[0].action,
                        upstream.act(infoset),
                    )

    def test_infoset_dto_covers_every_upstream_observation_field(self):
        env_path = self.upstream_root / "douzero" / "env" / "env.py"
        tree = ast.parse(env_path.read_text(encoding="utf-8"))
        upstream_fields = {
            node.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "infoset"
        }
        dto_fields = {field.name for field in fields(DouZeroInfoSetDTO)}

        self.assertTrue(upstream_fields)
        self.assertEqual(upstream_fields - dto_fields, set())


if __name__ == "__main__":
    unittest.main()
