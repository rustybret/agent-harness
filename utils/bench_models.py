#!/usr/bin/env python3
"""Benchmark opencode models for availability and tokens/sec.

For each model in MODELS, runs `opencode run --format json` with the prompt and
parses the streamed JSON events to extract:
  - output token count (incl. reasoning)
  - wall-clock seconds (first step_start -> last step_finish)
  - tokens/sec
  - status (ok / error / timeout)
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

MODELS = [
    "openai/gpt-5.1-codex-mini",
    "openai/gpt-5.1-codex-max",
    "openai/gpt-5.4-mini",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-5.2-codex",
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.5",
    "openai/gpt-5.2",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-opus-4-7",
    "anthropic/claude-opus-4-6",
    "google/gemini-3.1-flash-lite-preview",
    "google/gemini-2.5-flash-lite",
    "google/gemini-2.5-flash",
    "google/gemini-3-flash-preview",
    "google/gemini-2.5-pro",
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.1-pro-preview-customtools",
    "google/gemma-4-26b-a4b-it",
    "google/gemma-4-31b-it",
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-v4-flash",
    "moonshotai/kimi-k2.5",
    "moonshotai/kimi-k2.6",
    "nvidia/deepseek-ai/deepseek-v4-pro",
    "nvidia/deepseek-ai/deepseek-v4-flash",
    "openrouter/google/gemma-4-26b-a4b-it",
    "nvidia/google/gemma-4-31b-it",
    "openrouter/google/gemma-4-31b-it",
    "opencode/ling-2.6-flash-free",
    "opencode/nemotron-3-super-free",
    "groq/llama-3.1-8b-instant",
    "nvidia/minimaxai/minimax-m2.5",
    "opencode/minimax-m2.5-free",
    "openrouter/minimax/minimax-m2.5",
    "opencode/big-pickle",
    "openrouter/arcee-ai/trinity-large-preview",
    "openrouter/nousresearch/hermes-3-llama-3.1-405b",
    "groq/openai/gpt-oss-120b",
    "openrouter/openai/gpt-oss-120b",
    "nvidia/openai/gpt-oss-120b",
    "nvidia/mistralai/mistral-small-3.1-24b-instruct-2503",
    "nvidia/stepfun-ai/step-3.5-flash",
    "nvidia/meta/llama-4-maverick-17b-128e-instruct",
    "nvidia/z-ai/glm4.7",
    "nvidia/z-ai/glm5",
    "nvidia/z-ai/glm-5.1",
    "nvidia/mistralai/mistral-large-3-675b-instruct-2512",
]

LIST_FOR_PROMPT = "\n".join(MODELS)
PROMPT = (
    "Sort this list of models alphabetically, and then give each of the models "
    "an original nickname.\n" + LIST_FOR_PROMPT
)

WORKDIR = Path("/tmp/oc-bench")
WORKDIR.mkdir(exist_ok=True)
LOG_DIR = Path("/Volumes/Topper2TB/Git/agent-harness/utils/temp/bench-logs")
LOG_DIR.mkdir(exist_ok=True)

TIMEOUT = 180  # seconds per model
RESULTS_PATH = Path("/Volumes/Topper2TB/Git/agent-harness/utils/temp/bench_results.jsonl")

# Each line of stdout from --format json is a single event; collect:
#  - first step_start.timestamp (or fall back to part.time.start)
#  - last step_finish.timestamp (and tokens)
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
        # try to grab a one-line error from stderr or stdout
        status = "error"
    else:
        status = "no_finish"

    err_snippet = ""
    if status != "ok":
        snip = (stderr or stdout or "").strip().splitlines()
        # last non-empty line is usually most informative
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
    print(f"Benchmarking {len(MODELS)} models -> {RESULTS_PATH}", file=sys.stderr)
    for i, m in enumerate(MODELS, 1):
        print(f"[{i:>2}/{len(MODELS)}] {m} ...", file=sys.stderr, flush=True)
        res = run_one(m)
        print(f"      -> {res['status']:>8}  out={res['total_output_tokens']:>5}  "
              f"t={res['model_seconds'] or res['wall_seconds']}s  "
              f"tps={res['tokens_per_sec']}  err={res['error'][:80]!r}",
              file=sys.stderr, flush=True)
        with RESULTS_PATH.open("a") as f:
            f.write(json.dumps(res) + "\n")


if __name__ == "__main__":
    main()
