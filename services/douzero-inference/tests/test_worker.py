from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import unittest


TEST_ROOT = Path(__file__).parent
WORKER_PATH = TEST_ROOT.parent / "worker.py"
sys.path.insert(0, str(TEST_ROOT))

from test_action_adapter import PASS_ACTION, play_action
from test_state_adapter import make_deck, make_visible_state


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.process = subprocess.Popen(
            [sys.executable, str(WORKER_PATH), "--backend", "fake"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def tearDown(self):
        if self.process.poll() is None:
            self._request("shutdown", {})
        self.process.wait(timeout=5)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream is not None:
                stream.close()

    def test_ping_and_multiple_rank_requests_share_one_process(self):
        ping = self._request("ping", {})
        self.assertTrue(ping["ok"])
        self.assertEqual(ping["result"]["modelVersion"], "fake-deterministic-v1")
        self.assertIsInstance(ping["result"]["processId"], int)
        self.assertGreater(ping["result"]["processId"], 0)

        state = make_user_turn_state()
        hand = state["userHand"]
        actions = [
            play_action([hand[0]], "single"),
            play_action([hand[1]], "single"),
            PASS_ACTION,
        ]
        params = {
            "state": state,
            "legalActions": actions,
            "stateRef": {
                "gameId": state["gameId"],
                "revision": 1,
                "actionIndex": len(state["publicHistory"]),
                "stateChecksum": "test-checksum",
            },
            "topK": 2,
        }
        first = self._request("rank_actions", params)
        second = self._request("rank_actions", params)

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertEqual(first["result"]["actions"], second["result"]["actions"])
        self.assertEqual(len(first["result"]["actions"]), 2)
        source_ids = {action["actionId"] for action in actions}
        self.assertTrue(
            all(
                action["actionId"] in source_ids
                for action in first["result"]["actions"]
            ),
        )

    def test_returns_structured_error_and_remains_available(self):
        invalid = self._request(
            "rank_actions",
            {"state": {}, "legalActions": [], "stateRef": {}, "topK": 0},
        )
        ping = self._request("ping", {})

        self.assertFalse(invalid["ok"])
        self.assertEqual(invalid["error"]["code"], "invalid_request")
        self.assertTrue(ping["ok"])

    def _request(self, method, params):
        if self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError("worker pipes are unavailable")
        request_id = f"test-{method}"
        self.process.stdin.write(
            json.dumps({"id": request_id, "method": method, "params": params})
            + "\n",
        )
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        self.assertEqual(response["id"], request_id)
        return response


def make_user_turn_state():
    state = make_visible_state()
    state["publicHistory"] = state["publicHistory"][:2]
    state["remainingCardCounts"] = {"user": 17, "left": 19, "right": 17}
    state["currentTurn"] = "user"
    state["currentWinningPlay"] = state["publicHistory"][0]["play"]
    deck_by_id = {card["id"]: card for card in make_deck()}
    state["userHand"].append(deck_by_id["4-spade"])
    return state


if __name__ == "__main__":
    unittest.main()
