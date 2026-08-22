# DouZero inference adapter

This directory contains the project's integration layer for DouZero. Upstream
DouZero is not modified in place. Its repository and exact commit are recorded
in `upstream.lock.json` so model behavior can be reproduced and audited.

The first integration slice adds `RankedDeepAgent`, which preserves the
official agent's Top-1 behavior while exposing the model values for the Top-K
legal actions. The second slice adds a strict `PlayerVisibleGameState` to
DouZero `InfoSet` adapter without creating opponent hand partitions. The third
slice canonicalizes project-rule physical actions into one rank-multiset model
action and maps every model index back to a stable source `actionId`. The
long-lived worker process and coach-tool wiring remain intentionally separate
later slices.

The worker protocol and Node lifecycle client are now implemented. The worker
supports a deterministic fake backend for process, cache, timeout, and fallback
tests, plus a DouZero backend that loads the three positional agents once. A
real DouZero-WP model set has passed the Python and Node end-to-end paths. Its
checked-in manifest records a fixed community mirror commit, file sizes, and
SHA-256 hashes, but deliberately marks that model set as not approved for
production.

## Isolated runtime

The verified local runtime currently uses Python 3.14.6, PyTorch 2.13.0 CPU,
and NumPy 2.5.2. Install exactly the tested dependency set into an isolated
environment with:

```powershell
python -m venv services/douzero-inference/.runtime/venv
services/douzero-inference/.runtime/venv/Scripts/python.exe -m pip install --no-compile -r services/douzero-inference/requirements-runtime.lock.txt
```

Clone the source commit recorded in `upstream.lock.json` under
`services/douzero-inference/.runtime/upstream`. Model files belong under an
ignored `models` directory and are never committed. The current development
manifest expects:

```text
services/douzero-inference/models/douzero-wp-community-c010625/
├─ landlord.ckpt
├─ landlord_up.ckpt
└─ landlord_down.ckpt
```

The worker verifies every file before importing PyTorch model state. PyTorch
loads the checkpoint with `weights_only=True`. The community manifest requires
the explicit `--allow-unapproved-models` flag and must not be used as a
production default.

Run the dependency-free ranking tests with:

```powershell
npm.cmd run build --workspace @ai-doudizhu/coach-protocol
python -m unittest discover services/douzero-inference/tests -v
```

When the compiled game packages are present, the suite also simulates reachable
states with the project's real rule engine and verifies that every canonical
result maps back to a source legal action.

Run the Node-to-Python process tests without model weights:

```powershell
$env:DOUZERO_WORKER_TESTS = "1"
npm.cmd run test --workspace @ai-doudizhu/server -- douzero-worker-client.test.ts
```

Run both the Python and Node real-model checks after provisioning the ignored
runtime and model files:

```powershell
$env:DOUZERO_REAL_MODEL_TESTS = "1"
$env:DOUZERO_PYTHON_EXECUTABLE = (Resolve-Path services/douzero-inference/.runtime/venv/Scripts/python.exe).Path
$env:DOUZERO_UPSTREAM_PATH = (Resolve-Path services/douzero-inference/.runtime/upstream).Path
$env:DOUZERO_MODEL_MANIFEST = (Resolve-Path services/douzero-inference/model-manifest.community-wp.json).Path
$env:DOUZERO_MODELS_DIR = (Resolve-Path services/douzero-inference/models/douzero-wp-community-c010625).Path

services/douzero-inference/.runtime/venv/Scripts/python.exe -m unittest discover services/douzero-inference/tests -v
npm.cmd run test --workspace @ai-doudizhu/server -- douzero-worker-client.test.ts
```

Production inference remains disabled until an approved model source is
recorded and latency/resource baselines are accepted.

## Performance benchmark

The benchmark generates reachable states through the project rule engine,
starts the real worker three times, excludes five warm-up requests, measures
55 distinct uncached requests, verifies a cache hit, and records worker RSS:

```powershell
npm.cmd run strategy:benchmark -- --iterations 60 --warmup 5 --cold-starts 3
```

The first recorded Windows CPU baseline is stored in
`benchmarks/2026-08-10-windows-cpu-community-wp.json`. On an Intel Core
i7-14650HX it measured a 2.55-second cold-start P50, 4.00ms end-to-end P50,
9.42ms end-to-end P95, and approximately 245MiB worker RSS after the run.

Startup and inference now have separate timeout settings. The default startup
timeout is 15 seconds; the inference timeout remains 1 second.

The development-machine contention benchmark can be repeated with:

```powershell
npm.cmd run strategy:benchmark:contention
```

The recorded single-sample report is
`benchmarks/2026-08-22-windows-cpu-contention.json`. Concurrent local ASR/TTS
raised strategy end-to-end P95 from 8.02ms to 11.02ms with essentially no RSS
change. With an Ollama request in flight, P95 was 8.65ms. These measurements
are resource-conflict smoke tests rather than production capacity claims; both
remain comfortably below the 1-second inference timeout.
