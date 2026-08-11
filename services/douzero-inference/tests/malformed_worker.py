from __future__ import annotations

import json
import sys


for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if method == "ping":
        result = {
            "backend": "test",
            "modelVersion": "malformed-test-v1",
            "objective": "adp",
        }
    elif method == "shutdown":
        result = {"stopped": True}
    else:
        result = {"invalid": True}
    sys.stdout.write(
        json.dumps({"id": request.get("id"), "ok": True, "result": result})
        + "\n",
    )
    sys.stdout.flush()
    if method == "shutdown":
        break
