#!/usr/bin/env python3
"""Render the benchmark results into a sorted report, enriching each row with the
real error message extracted from the per-model log file."""
import json
import re
from pathlib import Path

RESULTS = Path("/Volumes/Topper2TB/Git/agent-harness/utils/temp/bench_results.jsonl")
LOG_DIR = Path("/Volumes/Topper2TB/Git/agent-harness/utils/temp/bench-logs")


def real_error(model_log_path: str) -> str:
    p = Path(model_log_path)
    if not p.exists():
        return ""
    txt = p.read_text(errors="ignore")
    # opencode error event lines look like:
    # {"type":"error","timestamp":...,"sessionID":"...","name":"...","message":"...",...}
    for line in txt.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        if ev.get("type") == "error":
            err = ev.get("error") or {}
            name = (err.get("name") if isinstance(err, dict) else "") or ev.get("name") or ""
            msg = ""
            data = err.get("data") if isinstance(err, dict) else None
            if isinstance(data, dict):
                msg = data.get("message") or data.get("error") or ""
                # try to pull the inner detail from a JSON-encoded body
                m = re.search(r'"detail"\s*:\s*"([^"]+)"', msg or "")
                if m:
                    msg = m.group(1)
                if not msg and isinstance(data.get("responseBody"), str):
                    msg = data["responseBody"][:200]
            if not msg:
                msg = ev.get("message") or ""
            combined = " | ".join(s for s in [name, msg] if s)
            return combined[:240]
    # Fallback: scan stderr block for the most informative line
    block = txt.split("# --- stderr ---", 1)
    if len(block) == 2:
        for ln in reversed(block[1].splitlines()):
            ln = ln.strip()
            if ln and "afterScheduled" not in ln and not ln.startswith("at "):
                return ln[:300]
    return ""


def load() -> list[dict]:
    rows = []
    with RESULTS.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            row["error"] = real_error(row.get("log", ""))
            rows.append(row)
    return rows


def fmt_row(r):
    tps = r.get("tokens_per_sec")
    tps_s = f"{tps:>6.1f}" if isinstance(tps, (int, float)) else "    -"
    sec = r.get("model_seconds") or r.get("wall_seconds") or 0
    out_t = r.get("total_output_tokens") or 0
    return f"{r['status']:>9}  {tps_s} t/s  {out_t:>5} tok  {sec:>7.2f}s  {r['model']}"


def main():
    rows = load()
    ok = [r for r in rows if r["status"] == "ok"]
    bad = [r for r in rows if r["status"] != "ok"]

    ok.sort(key=lambda r: -(r.get("tokens_per_sec") or 0))
    # Group bad rows by error fingerprint
    def fp(r):
        e = r["error"] or ""
        return re.sub(r"\d{6,}|ses_[A-Za-z0-9]+|prt_[A-Za-z0-9]+|msg_[A-Za-z0-9]+", "*", e)[:160]
    bad.sort(key=lambda r: (fp(r), r["model"]))

    print("=" * 100)
    print(f"AVAILABLE / RANKED BY THROUGHPUT  ({len(ok)}/{len(rows)} models responded)")
    print("=" * 100)
    print(f"{'status':>9}  {'t/s':>10}  {'output':>5}      {'time':>7}   model")
    for r in ok:
        print(fmt_row(r))

    print()
    print("=" * 100)
    print(f"FAILURES  ({len(bad)} models)")
    print("=" * 100)

    # bucket by error fingerprint
    buckets: dict[str, list[dict]] = {}
    for r in bad:
        buckets.setdefault(fp(r), []).append(r)
    for key, items in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
        print(f"\n[{len(items)}] {key or '(no error message captured)'}")
        for r in items:
            print(f"   - {r['model']}  (status={r['status']}, wall={r['wall_seconds']}s)")


if __name__ == "__main__":
    main()
