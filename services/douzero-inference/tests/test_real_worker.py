from __future__ import annotations

import json
import math
import os
from pathlib import Path
import subprocess
import sys
import unittest


TEST_ROOT = Path(__file__).parent
WORKER_PATH = TEST_ROOT.parent / "worker.py"
sys.path.insert(0, str(TEST_ROOT))

from test_action_adapter import PASS_ACTION, play_action
from test_worker import make_user_turn_state


@unittest.skipUnless(
    os.environ.get("DOUZERO_REAL_MODEL_TESTS") == "1",
    "real model runtime is not configured",
)
class RealWorkerTests(unittest.TestCase):
    def test_loads_verified_models_and_ranks_a_visible_state(self):
        upstream = self._required_path("DOUZERO_UPSTREAM_PATH")
        manifest = self._required_path("DOUZERO_MODEL_MANIFEST")
        models = self._required_path("DOUZERO_MODELS_DIR")
        process = subprocess.Popen(
            [
                sys.executable,
                str(WORKER_PATH),
                "--backend",
                "douzero",
                "--upstream-path",
                str(upstream),
                "--model-manifest",
                str(manifest),
                "--models-dir",
                str(models),
                "--allow-unapproved-models",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            ping = self._request(process, "ping", {})
            self.assertTrue(ping["ok"])
            self.assertEqual(ping["result"]["backend"], "douzero")
            self.assertEqual(ping["result"]["objective"], "wp")

            state = make_user_turn_state()
            hand = state["userHand"]
            distinct_rank_card = next(
                card for card in hand if card["rank"] != hand[0]["rank"]
            )
            legal_actions = [
                play_action([hand[0]], "single"),
                play_action([distinct_rank_card], "single"),
                PASS_ACTION,
            ]
            response = self._request(
                process,
                "rank_actions",
                {
                    "state": state,
                    "legalActions": legal_actions,
                    "stateRef": {
                        "gameId": state["gameId"],
                        "revision": 1,
                        "actionIndex": len(state["publicHistory"]),
                        "stateChecksum": "real-model-test",
                    },
                    "topK": 3,
                },
            )
            self.assertTrue(response["ok"], response)
            result = response["result"]
            self.assertEqual(result["source"], "douzero")
            self.assertEqual(result["position"], "landlord_up")
            self.assertEqual(len(result["actions"]), 3)
            self.assertTrue(
                all(math.isfinite(action["modelScore"]) for action in result["actions"]),
            )
        finally:
            if process.poll() is None:
                try:
                    self._request(process, "shutdown", {})
                except (AssertionError, BrokenPipeError, OSError):
                    process.kill()
            process.wait(timeout=10)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()

    @staticmethod
    def _required_path(name: str) -> Path:
        value = os.environ.get(name)
        if not value:
            raise AssertionError(f"{name} is required")
        path = Path(value).resolve()
        if not path.exists():
            raise AssertionError(f"{name} does not exist: {path}")
        return path

    @staticmethod
    def _request(process, method, params):
        if process.stdin is None or process.stdout is None:
            raise AssertionError("worker pipes are unavailable")
        process.stdin.write(
            json.dumps({"id": method, "method": method, "params": params}) + "\n",
        )
        process.stdin.flush()
        line = process.stdout.readline()
        if not line:
            stderr = process.stderr.read() if process.stderr else ""
            raise AssertionError(f"worker exited without response: {stderr}")
        return json.loads(line)


if __name__ == "__main__":
    unittest.main()
