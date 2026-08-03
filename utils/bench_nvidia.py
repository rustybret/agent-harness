#!/usr/bin/env python3
"""Benchmark NVIDIA NIM models for latency, speed, errors, blank responses, and tool call activation.

For each model in DEFAULT_MODELS (or passed via CLI / BENCH_MODELS), runs `opencode run --format json`
with a tool-activation benchmark prompt based on openclaw-bench-request.txt.

Monitors:
  - Time To First Token / Event (TTFT)
  - Wall-clock & model-clock latency
  - Output tokens per second (generation speed)
  - Blank / empty responses
  - Tool call activation (attempted, succeeded, failed)
  - Errors and HTTP failure snippets
  - Enforces a 60-second cooldown delay between model runs to prevent provider rate-limiting.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# 15 NVIDIA NIM models from build.nvidia.com URLs mapped to opencode model IDs
DEFAULT_NVIDIA_URL_MODELS: List[Tuple[str, str]] = [
    (
        "https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b",
        "nvidia/nvidia/nemotron-3-super-120b-a12b",
    ),
    (
        "https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b",
        "nvidia/nvidia/nemotron-3-ultra-550b-a55b",
    ),
    (
        "https://build.nvidia.com/openai/gpt-oss-120b",
        "nvidia/openai/gpt-oss-120b",
    ),
    (
        "https://build.nvidia.com/meta/llama-3_3-70b-instruct",
        "nvidia/meta/llama-3.3-70b-instruct",
    ),
    (
        "https://build.nvidia.com/qwen/qwen3-next-80b-a3b-instruct",
        "nvidia/qwen/qwen3-next-80b-a3b-instruct",
    ),
    (
        "https://build.nvidia.com/openai/gpt-oss-20b",
        "nvidia/openai/gpt-oss-20b",
    ),
    (
        "https://build.nvidia.com/deepseek-ai/deepseek-v4-flash",
        "nvidia/deepseek-ai/deepseek-v4-flash",
    ),
    (
        "https://build.nvidia.com/stepfun-ai/step-3.5-flash",
        "nvidia/stepfun-ai/step-3.5-flash",
    ),
    (
        "https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "nvidia/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    ),
    (
        "https://build.nvidia.com/stepfun-ai/step-3.7-flash",
        "nvidia/stepfun-ai/step-3.7-flash",
    ),
    (
        "https://build.nvidia.com/nvidia/llama-3_3-nemotron-super-49b-v1_5",
        "nvidia/nvidia/llama-3.3-nemotron-super-49b-v1.5",
    ),
    (
        "https://build.nvidia.com/google/gemma-4-31b-it",
        "nvidia/google/gemma-4-31b-it",
    ),
    (
        "https://build.nvidia.com/mistralai/mistral-medium-3.5-128b",
        "nvidia/mistralai/mistral-medium-3.5-128b",
    ),
    (
        "https://build.nvidia.com/mistralai/mistral-nemotron",
        "nvidia/mistralai/mistral-nemotron",
    ),
    (
        "https://build.nvidia.com/bytedance/seed-oss-36b-instruct",
        "nvidia/bytedance/seed-oss-36b-instruct",
    ),
]

DEFAULT_MODELS: List[str] = [m[1] for m in DEFAULT_NVIDIA_URL_MODELS]
URL_MAP: Dict[str, str] = {m[1]: m[0] for m in DEFAULT_NVIDIA_URL_MODELS}

# Benchmark prompt based on /Volumes/Topper2TB/Git/cloudhome/tmp/openclaw-bench-request.txt
DEFAULT_PROMPT = (
    'Reply with exactly: "OpenClaw bench test received." Then query the live '
    "Kubernetes node list or execute a system check using available tools and report "
    "only the number of Ready and NotReady nodes. Use a tool for the query; do not infer the result."
)

WORKDIR = Path("/tmp/oc-bench-nvidia")
LOG_DIR = Path("/Volumes/Topper2TB/Git/agent-harness/utils/temp/bench-logs-nvidia")
DEFAULT_RESULTS_PATH = Path(
    "/Volumes/Topper2TB/Git/agent-harness/utils/temp/bench_results_nvidia.jsonl"
)
DEFAULT_TIMEOUT = 180  # seconds per model
DEFAULT_COOLDOWN = 60  # seconds delay between models to avoid provider overload


def normalize_model_identifier(raw_input: str) -> str:
    """Normalize URLs or partial strings into valid opencode model IDs."""
    raw = raw_input.strip()
    if raw.startswith("https://build.nvidia.com/"):
        rel_path = raw.replace("https://build.nvidia.com/", "").strip("/")
        # Handle known underscores vs dots mapping
        rel_path_dot = rel_path.replace("llama-3_3", "llama-3.3").replace("v1_5", "v1.5")
        return f"nvidia/{rel_path_dot}"
    if not raw.startswith("nvidia/") and not raw.startswith("openrouter/") and not raw.startswith("google/"):
        return f"nvidia/{raw}"
    return raw


def resolve_models(cli_models: List[str]) -> List[str]:
    """Resolve model list from CLI args, BENCH_MODELS env var, or DEFAULT_MODELS."""
    if cli_models:
        return [normalize_model_identifier(m) for m in cli_models]
    env_models = os.environ.get("BENCH_MODELS", "").strip()
    if env_models:
        raw_list = [m.strip() for m in re.split(r"[,\n]+", env_models) if m.strip()]
        return [normalize_model_identifier(m) for m in raw_list]
    return DEFAULT_MODELS


def run_one(
    model: str,
    prompt: str,
    timeout: int,
    workdir: Path,
    log_dir: Path,
) -> Dict[str, Any]:
    """Execute opencode run --format json for a single model and analyze results."""
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", model)
    log_path = log_dir / f"{safe_name}.log"

    cmd = [
        "opencode",
        "run",
        "--format",
        "json",
        "-m",
        model,
        "--dangerously-skip-permissions",
        prompt,
    ]

    t_start_wall = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(workdir),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        elapsed_wall = time.time() - t_start_wall
        rc = proc.returncode
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
    except subprocess.TimeoutExpired as e:
        elapsed_wall = time.time() - t_start_wall
        stdout = (
            e.stdout.decode()
            if isinstance(e.stdout, (bytes, bytearray))
            else (e.stdout or "")
        )
        stderr = (
            e.stderr.decode()
            if isinstance(e.stderr, (bytes, bytearray))
            else (e.stderr or "")
        )
        rc = -1

    log_path.write_text(
        f"# url: {URL_MAP.get(model, 'N/A')}\n"
        f"# cmd: {' '.join(repr(c) for c in cmd)}\n"
        f"# rc={rc} wall={elapsed_wall:.2f}s\n"
        f"# --- stdout ---\n{stdout}\n"
        f"# --- stderr ---\n{stderr}\n"
    )

    first_step_ts: Optional[float] = None
    first_token_ts: Optional[float] = None
    last_step_ts: Optional[float] = None

    output_tokens = 0
    reasoning_tokens = 0
    input_tokens = 0
    cost = 0.0
    text_chars = 0
    saw_finish = False
    finish_reason: Optional[str] = None
    top_level_error: Optional[str] = None

    tool_calls_attempted = 0
    tool_calls_succeeded = 0
    tool_calls_failed = 0
    tool_names_used: List[str] = []

    for line in stdout.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue

        ts = ev.get("timestamp")
        ev_type = ev.get("type")

        if isinstance(ts, (int, float)):
            if first_step_ts is None:
                first_step_ts = ts
            last_step_ts = ts

        if ev_type == "error":
            err_data = ev.get("error") or {}
            msg = ""
            if isinstance(err_data, dict):
                msg = err_data.get("message") or (err_data.get("data") or {}).get("message") or str(err_data)
            else:
                msg = str(err_data)
            top_level_error = msg[:240]

        part = ev.get("part") or {}

        if ev_type == "text":
            txt = part.get("text") or ""
            text_chars += len(txt)
            if first_token_ts is None and isinstance(ts, (int, float)):
                first_token_ts = ts

        if ev_type in ("tool_use", "tool") or part.get("type") == "tool":
            tool_calls_attempted += 1
            if first_token_ts is None and isinstance(ts, (int, float)):
                first_token_ts = ts

            tool_name = part.get("tool") or part.get("name") or "unknown"
            if tool_name not in tool_names_used:
                tool_names_used.append(tool_name)

            state = part.get("state") or {}
            status = state.get("status")
            if status == "error":
                tool_calls_failed += 1
            else:
                tool_calls_succeeded += 1

        if ev_type == "step_finish":
            saw_finish = True
            finish_reason = part.get("reason")
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

    # Compute latencies
    ttft_seconds: Optional[float] = None
    if first_token_ts is not None and first_step_ts is not None:
        ttft_seconds = max(0.0, (first_token_ts - first_step_ts) / 1000.0)

    elapsed_model: Optional[float] = None
    if first_step_ts is not None and last_step_ts is not None and last_step_ts > first_step_ts:
        elapsed_model = (last_step_ts - first_step_ts) / 1000.0

    total_out_tokens = (output_tokens or 0) + (reasoning_tokens or 0)
    elapsed_for_rate = elapsed_model or elapsed_wall
    tps = (total_out_tokens / elapsed_for_rate) if (elapsed_for_rate and total_out_tokens) else None

    # Determine status & anomalies
    tool_activated = tool_calls_attempted > 0
    expects_tool = any(kw in prompt.lower() for kw in ["tool", "query", "check"])

    if rc == -1:
        status = "timeout"
    elif top_level_error or rc != 0:
        status = "error"
    elif not saw_finish:
        status = "no_finish"
    elif text_chars == 0 and not tool_activated:
        status = "blank_response"
    elif tool_calls_failed > 0:
        status = "tool_call_error"
    elif expects_tool and not tool_activated:
        status = "failed_tool_activation"
    else:
        status = "ok"

    # Extract error snippet if not ok
    err_snippet = top_level_error or ""
    if status != "ok" and not err_snippet:
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
        "nvidia_url": URL_MAP.get(model, ""),
        "status": status,
        "rc": rc,
        "wall_seconds": round(elapsed_wall, 3),
        "model_seconds": round(elapsed_model, 3) if elapsed_model else None,
        "ttft_seconds": round(ttft_seconds, 3) if ttft_seconds is not None else None,
        "input_tokens": input_tokens or 0,
        "output_tokens": output_tokens or 0,
        "reasoning_tokens": reasoning_tokens or 0,
        "total_output_tokens": total_out_tokens,
        "tokens_per_sec": round(tps, 2) if tps else None,
        "text_chars": text_chars,
        "tool_activated": tool_activated,
        "tool_calls_attempted": tool_calls_attempted,
        "tool_calls_succeeded": tool_calls_succeeded,
        "tool_calls_failed": tool_calls_failed,
        "tool_names_used": tool_names_used,
        "finish_reason": finish_reason,
        "cost_usd": cost,
        "error": err_snippet,
        "log": str(log_path),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Benchmark NVIDIA NIM models for latency, throughput, errors, and tool calling."
    )
    parser.add_argument(
        "models",
        nargs="*",
        help="Optional model IDs or build.nvidia.com URLs to benchmark.",
    )
    parser.add_argument(
        "--prompt",
        default=DEFAULT_PROMPT,
        help="Prompt text for the benchmark run.",
    )
    parser.add_argument(
        "--cooldown",
        type=int,
        default=DEFAULT_COOLDOWN,
        help=f"Cooldown delay in seconds between models (default: {DEFAULT_COOLDOWN}s).",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"Timeout in seconds per model run (default: {DEFAULT_TIMEOUT}s).",
    )
    parser.add_argument(
        "--no-wait",
        action="store_true",
        help="Disable cooldown wait between models (for testing/dry-runs).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_RESULTS_PATH,
        help=f"Path to write JSONL results (default: {DEFAULT_RESULTS_PATH}).",
    )
    args = parser.parse_args()

    WORKDIR.mkdir(exist_ok=True)
    LOG_DIR.mkdir(exist_ok=True)
    args.output.parent.mkdir(exist_ok=True)

    models_to_bench = resolve_models(args.models)

    if args.output.exists():
        args.output.unlink()

    print(
        f"=== NVIDIA NIM Benchmark Strategy ===",
        file=sys.stderr,
    )
    print(f"Models to test   : {len(models_to_bench)}", file=sys.stderr)
    print(f"Cooldown per run : {0 if args.no_wait else args.cooldown}s", file=sys.stderr)
    print(f"Per-model timeout: {args.timeout}s", file=sys.stderr)
    print(f"Results JSONL    : {args.output}", file=sys.stderr)
    print(f"Log Directory    : {LOG_DIR}\n", file=sys.stderr)

    for i, m in enumerate(models_to_bench, 1):
        url_info = f" ({URL_MAP[m]})" if m in URL_MAP else ""
        print(f"[{i:>2}/{len(models_to_bench)}] Benchmarking {m}{url_info} ...", file=sys.stderr, flush=True)

        res = run_one(
            model=m,
            prompt=args.prompt,
            timeout=args.timeout,
            workdir=WORKDIR,
            log_dir=LOG_DIR,
        )

        ttft_str = f"{res['ttft_seconds']}s" if res['ttft_seconds'] is not None else "N/A"
        tools_str = f"{res['tool_calls_succeeded']}/{res['tool_calls_attempted']}"
        print(
            f"      -> status={res['status']:<22} TTFT={ttft_str:>6} "
            f"OutTok={res['total_output_tokens']:>5} TPS={str(res['tokens_per_sec'] or 'N/A'):>6} "
            f"Wall={res['wall_seconds']:>6.1f}s Tools={tools_str}",
            file=sys.stderr,
            flush=True,
        )
        if res["error"]:
            print(f"         Error: {res['error'][:100]!r}", file=sys.stderr, flush=True)

        with args.output.open("a") as f:
            f.write(json.dumps(res) + "\n")

        # Cooldown wait between model calls unless it's the last model or --no-wait is set
        if not args.no_wait and i < len(models_to_bench):
            print(f"      Waiting {args.cooldown}s cooldown before next model...", file=sys.stderr, flush=True)
            time.sleep(args.cooldown)

    # Print final summary table
    print("\n" + "=" * 125, file=sys.stderr)
    print("=== FINAL BENCHMARK SUMMARY ===", file=sys.stderr)
    print("=" * 125, file=sys.stderr)
    header = f"{'MODEL':<45} {'STATUS':<22} {'TTFT':>6} {'WALL':>6} {'OUT_TOK':>7} {'TPS':>6} {'TOOLS':>7} ERROR/NOTES"
    print(header, file=sys.stderr)
    print("-" * 125, file=sys.stderr)

    if args.output.exists():
        results = [json.loads(l) for l in args.output.read_text().splitlines() if l.strip()]
        for r in results:
            ttft = f"{r['ttft_seconds']:.2f}s" if r["ttft_seconds"] is not None else "-"
            tps = f"{r['tokens_per_sec']:.1f}" if r["tokens_per_sec"] is not None else "-"
            tools = f"{r['tool_calls_succeeded']}/{r['tool_calls_attempted']}"
            err = r["error"][:35] if r["error"] else ""
            print(
                f"{r['model']:<45} {r['status']:<22} {ttft:>6} {r['wall_seconds']:>5.1f}s "
                f"{r['total_output_tokens']:>7} {tps:>6} {tools:>7} {err}",
                file=sys.stderr,
            )


if __name__ == "__main__":
    main()
