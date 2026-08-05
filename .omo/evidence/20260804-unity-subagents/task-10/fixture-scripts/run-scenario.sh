#!/usr/bin/env bash
# Runs ONE task-10 scenario end-to-end in the isolated sandbox:
#   1. start the fixture MCP server on a random free port (never 27182)
#   2. rewrite the scratch unity-scene skill url to that fixture port
#   3. drive opencode (isolated XDG + sandbox project dir) with the scenario prompt
#   4. capture the opencode --format json transcript + the fixture ordered log
#   5. kill the fixture PID individually (rule #2598 — no unscoped pkill)
#
# Usage:
#   run-scenario.sh <scenario-id> <agent> <prompt> <out-dir> [--stop-fixture-early]
#
# Env in (from sourced qa-sandbox.sh + setup-sandbox.sh):
#   OMO_QA_ROOT, XDG_*, SBX_PROJECT, SBX_SKILLS
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"

SID="$1"; AGENT="$2"; PROMPT="$3"; OUT="$4"; MODE="${5:-}"
: "${OMO_QA_ROOT:?source qa-sandbox.sh + setup-sandbox.sh first}"
: "${SBX_PROJECT:?run setup-sandbox.sh first}"
: "${SBX_SKILLS:?run setup-sandbox.sh first}"

mkdir -p "$OUT"
FIX_LOG="$OUT/fixture-requests.jsonl"
: > "$FIX_LOG"
READY="$OUT/fixture-ready.txt"; : > "$READY"
FIX_ERR="$OUT/fixture-stderr.txt"; : > "$FIX_ERR"

echo "[$SID] starting fixture..."
FIXTURE_LOG="$FIX_LOG" node "$REPO_ROOT/.local-ignore/qa/fake-mcp-server.mjs" > "$READY" 2> "$FIX_ERR" &
FIXPID=$!
for i in $(seq 1 60); do
  PORT=$(awk '/FIXTURE_READY/{print $2}' "$READY" 2>/dev/null)
  [ -n "$PORT" ] && break
  sleep 0.1
done
if [ -z "${PORT:-}" ]; then
  echo "[$SID] FIXTURE FAILED TO START"; cat "$FIX_ERR"; kill "$FIXPID" 2>/dev/null; exit 1
fi
echo "[$SID] fixture pid=$FIXPID port=$PORT (never 27182: $([ "$PORT" = 27182 ] && echo VIOLATION || echo ok))"
echo "$PORT" > "$OUT/fixture-port.txt"

# Rewrite ALL six scratch skill urls to the fixture port. All six share the
# server name "supermcp", so skill_mcp(mcp_name="supermcp") resolves across every
# loaded skill; rewriting only unity-scene lets bridge_status leak to the real
# 27182 bridge via a sibling skill. Rewriting all six closes that leak.
node "$REPO_ROOT/.local-ignore/qa/rewrite-all-urls.mjs" "$SBX_SKILLS" "$PORT" | tee "$OUT/url-rewrite.txt"

if [ "$MODE" = "--stop-fixture-early" ]; then
  echo "[$SID] failure-path: killing fixture BEFORE the run to force a connection error"
  kill "$FIXPID" 2>/dev/null
  wait "$FIXPID" 2>/dev/null
  echo "killed-early" > "$OUT/fixture-stopped.txt"
fi

# Dispatch via the default PRIMARY agent, instructing it to call task() exactly
# once against the restricted subagent. (Subagents cannot be driven with --agent:
# `opencode run --agent <subagent>` falls back to the default primary agent.)
DISPATCH="I'm working in this Unity project with the SuperMCP bridge running. I want the restricted \"$AGENT\" subagent to handle a Unity request for me. Please call task(subagent_type=\"$AGENT\", prompt=\"$PROMPT\") and hand me back whatever it returns, including if it reports itself blocked. The subagent owns the Unity bridge, so let it do the Unity work rather than inspecting the project files yourself."
echo "[$SID] driving opencode via task(subagent_type=$AGENT)..."
set +e
( cd "$SBX_PROJECT" && opencode run --format json --auto "$DISPATCH" ) \
  > "$OUT/transcript.jsonl" 2> "$OUT/opencode-stderr.txt"
RC=$?
set -e 2>/dev/null || true
echo "[$SID] opencode rc=$RC"
echo "$RC" > "$OUT/opencode-rc.txt"

if [ "$MODE" != "--stop-fixture-early" ]; then
  kill "$FIXPID" 2>/dev/null
  wait "$FIXPID" 2>/dev/null
fi
echo "[$SID] done. transcript=$OUT/transcript.jsonl fixture-log=$FIX_LOG"
