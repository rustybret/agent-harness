#!/usr/bin/env python3
"""One-off bench run: Google provider models only, short self-description prompt."""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_MODELS = [
    "google/antigravity-gemini-3.1-flash-image",
    "google/antigravity-gemini-3.1-flash-lite",
    "google/antigravity-gemini-3.1-pro",
    "google/antigravity-gemini-3.1-pro-high",
    "google/antigravity-gemini-3.1-pro-low",
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.1-pro-preview-customtools",
]

# Models can be overridden from the CLI:
#   python bench_google.py google/antigravity-gemini-3.1-pro google/gemini-3.1-pro-preview
# or via a newline/comma separated env var:
#   BENCH_MODELS="google/antigravity-gemini-3.1-pro,google/gemini-3.5-flash" python bench_google.py
def resolve_models() -> list[str]:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        return args
    env = os.environ.get("BENCH_MODELS", "").strip()
    if env:
        return [m.strip() for m in re.split(r"[,\n]+", env) if m.strip()]
    return DEFAULT_MODELS


MODELS = resolve_models()

PROMPT = (
    "Describe yourself and your capabilities with a response between "
    "200 and 300 words in length."
)

WORKDIR = Path("/tmp/oc-bench-google")
WORKDIR.mkdir(exist_ok=True)
LOG_DIR = Path("/Volumes/Topper2TB/Git/agent-harness/utils/temp/bench-logs-gemini31")
LOG_DIR.mkdir(exist_ok=True)

TIMEOUT = 180  # seconds per model
RESULTS_PATH = Path("/Volumes/Topper2TB/Git/agent-harness/utils/temp/bench_results_gemini31.jsonl")


def run_one(model: str):
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", model)
    log_path = LOG_DIR / f"{safe}.log"
    cmd = [
        "opencode", "run",
        "--format", "json",
        "-m", model,
        "--dangerously-skip-permissions",
        PROMPT,
    ]
    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(WORKDIR),
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
        )
        elapsed_wall = time.time() - t0
        rc = proc.returncode
        stdout = proc.stdout
        stderr = proc.stderr
    except subprocess.TimeoutExpired as e:
        elapsed_wall = time.time() - t0
        stdout = (e.stdout.decode() if isinstance(e.stdout, (bytes, bytearray)) else (e.stdout or ""))
        stderr = (e.stderr.decode() if isinstance(e.stderr, (bytes, bytearray)) else (e.stderr or ""))
        rc = -1

    log_path.write_text(
        f"# cmd: {' '.join(repr(c) for c in cmd)}\n"
        f"# rc={rc} wall={elapsed_wall:.2f}\n"
        f"# --- stdout ---\n{stdout}\n"
        f"# --- stderr ---\n{stderr}\n"
    )

    first_ts = None
    last_ts = None
    output_tokens = 0
    reasoning_tokens = 0
    input_tokens = 0
    cost = 0.0
    text_chars = 0
    saw_finish = False
    parse_err = None
    for line in stdout.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except Exception as ex:
            parse_err = str(ex)
            continue
        ts = ev.get("timestamp")
        if isinstance(ts, (int, float)):
            if first_ts is None:
                first_ts = ts
            last_ts = ts
        t = ev.get("type")
        part = ev.get("part") or {}
        if t == "text":
            txt = part.get("text") or ""
            text_chars += len(txt)
        if t == "step_finish":
            saw_finish = True
            tk = part.get("tokens") or {}
            output_tokens = tk.get("output", output_tokens) or output_tokens
            reasoning_tokens = tk.get("reasoning", reasoning_tokens) or reasoning_tokens
            input_tokens = tk.get("input", input_tokens) or input_tokens
            c = ev.get("cost")
            if isinstance(c, (int, float)):
                cost = c
            pc = part.get("cost")
            if isinstance(pc, (int, float)):
                cost = pc

    elapsed_model = None
    if first_ts is not None and last_ts is not None and last_ts > first_ts:
        elapsed_model = (last_ts - first_ts) / 1000.0

    total_out = (output_tokens or 0) + (reasoning_tokens or 0)
    elapsed_for_rate = elapsed_model or elapsed_wall
    tps = (total_out / elapsed_for_rate) if (elapsed_for_rate and total_out) else None

    if rc == 0 and saw_finish:
        status = "ok"
    elif rc == -1:
        status = "timeout"
    elif rc != 0:
        status = "error"
    else:
        status = "no_finish"

    err_snippet = ""
    if status != "ok":
        snip = (stderr or stdout or "").strip().splitlines()
        for s in reversed(snip):
            s = s.strip()
            if s and not s.startswith("{"):
                err_snippet = s[:240]
                break
        if not err_snippet and snip:
            err_snippet = snip[-1][:240]

    return {
        "model": model,
        "status": status,
        "rc": rc,
        "wall_seconds": round(elapsed_wall, 3),
        "model_seconds": round(elapsed_model, 3) if elapsed_model else None,
        "input_tokens": input_tokens or 0,
        "output_tokens": output_tokens or 0,
        "reasoning_tokens": reasoning_tokens or 0,
        "total_output_tokens": total_out,
        "tokens_per_sec": round(tps, 2) if tps else None,
        "text_chars": text_chars,
        "cost_usd": cost,
        "error": err_snippet,
        "log": str(log_path),
    }


def main():
    if RESULTS_PATH.exists():
        RESULTS_PATH.unlink()
    print(f"Benchmarking {len(MODELS)} Google models -> {RESULTS_PATH}", file=sys.stderr)
    print(f"Prompt: {PROMPT!r}", file=sys.stderr)
    for i, m in enumerate(MODELS, 1):
        print(f"[{i:>2}/{len(MODELS)}] {m} ...", file=sys.stderr, flush=True)
        res = run_one(m)
        print(
            f"      -> {res['status']:>8}  out={res['total_output_tokens']:>5}  "
            f"t={res['model_seconds'] or res['wall_seconds']}s  "
            f"tps={res['tokens_per_sec']}  err={res['error'][:80]!r}",
            file=sys.stderr, flush=True,
        )
        with RESULTS_PATH.open("a") as f:
            f.write(json.dumps(res) + "\n")

    # Print summary table
    print("\n=== RESULTS ===", file=sys.stderr)
    print(f"{'MODEL':<45} {'STATUS':>8}  {'OUT_TOK':>7}  {'TPS':>6}  {'WALL_S':>6}  ERROR", file=sys.stderr)
    print("-" * 110, file=sys.stderr)
    results = [json.loads(l) for l in RESULTS_PATH.read_text().splitlines() if l.strip()]
    for r in results:
        err = r["error"][:40] if r["error"] else ""
        print(
            f"{r['model']:<45} {r['status']:>8}  {r['total_output_tokens']:>7}  "
            f"{str(r['tokens_per_sec'] or ''):>6}  {r['wall_seconds']:>6.1f}s  {err}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
