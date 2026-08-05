#!/usr/bin/env bash
# Builds the THROWAWAY FIXTURE PROJECT DIR for unity-supermcp-subagents task-10.
# SOURCE this after sourcing script/agent/qa-sandbox.sh (which sets OMO_QA_ROOT +
# isolated XDG). It never touches the real repo's .omo/omo.jsonc, .opencode/agents/,
# or packages/supermcp-skills/ as the project dir — it only COPIES from them into
# an isolated sandbox project dir.
#
# Exports:
#   SBX_PROJECT   the opencode project dir  ($OMO_QA_ROOT/project)
#   SBX_SKILLS    scratch vendored-skills dir ($OMO_QA_ROOT/vendored-skills)
#
# Requires: OMO_QA_ROOT, XDG_CONFIG_HOME, XDG_DATA_HOME set (from qa-sandbox.sh).

set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"

: "${OMO_QA_ROOT:?source script/agent/qa-sandbox.sh first}"

SBX_PROJECT="$OMO_QA_ROOT/project"
SBX_SKILLS="$OMO_QA_ROOT/vendored-skills"
export SBX_PROJECT SBX_SKILLS

mkdir -p "$SBX_PROJECT/.opencode/agents" "$SBX_PROJECT/.omo" "$SBX_SKILLS"

# (a) Copy the seven restricted agent .md files from the real repo.
for a in unity-editor unity-scene unity-script-roslyn unity-asset unity-build unity-runtime unity-bridge-bootstrap; do
  cp "$REPO_ROOT/.opencode/agents/$a.md" "$SBX_PROJECT/.opencode/agents/$a.md"
done

# (b) Copy the six vendored skills into the scratch dir (url rewritten later,
# per-scenario, by rewrite-scene-url.sh to point at the fixture port).
cp -R "$REPO_ROOT/packages/supermcp-skills/skills/." "$SBX_SKILLS/"

# (c) Minimal project .omo/omo.jsonc: skills.sources -> scratch vendored-skills
# (absolute path, machine-local to the sandbox), plus the todo-8 fallback_models
# for the two agents under test so dispatch-model behavior matches production.
cat > "$SBX_PROJECT/.omo/omo.jsonc" <<JSONC
// Throwaway sandbox config for unity-supermcp-subagents task-10 QA.
{
  "\$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "[opencode]": {
    "skills": {
      "sources": [
        { "path": "$SBX_SKILLS", "recursive": true }
      ]
    },
    "agents": {
      "unity-editor": {
        "fallback_models": [
          { "model": "openai/gpt-5.5", "reasoning": "low" },
          "opencode/deepseek-v4-flash-free",
          { "model": "anthropic/claude-opus-5", "reasoning": "low" },
          "opencode/gemini-3.6-flash",
          "opencode/gemini-3.5-flash",
          "opencode/gemini-3-flash",
          "google/gemma-4-31b-it"
        ]
      },
      "unity-scene": {
        "fallback_models": [
          { "model": "openai/gpt-5.5", "reasoning": "low" },
          "opencode/deepseek-v4-flash-free",
          { "model": "anthropic/claude-opus-5", "reasoning": "low" },
          "opencode/gemini-3.6-flash",
          "opencode/gemini-3.5-flash",
          "opencode/gemini-3-flash",
          "google/gemma-4-31b-it"
        ]
      }
    }
  },
  "_migrations": [ "2026-07-opencode-config-unification", "2026-08-reasoning-unification" ]
}
JSONC

# opencode config in the ISOLATED XDG_CONFIG_HOME: register the built omo plugin.
mkdir -p "$XDG_CONFIG_HOME/opencode"
cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": [ "file://$REPO_ROOT/dist/index.js" ]
}
JSON

# Auth: copy host provider auth into the isolated data dir so models resolve.
# READ-ONLY on the host; we only copy OUT of it.
mkdir -p "$XDG_DATA_HOME/opencode"
if [ -f "$HOME/.local/share/opencode/auth.json" ]; then
  cp "$HOME/.local/share/opencode/auth.json" "$XDG_DATA_HOME/opencode/auth.json"
fi

# Seed the sandbox project so the PRIMARY agent recognizes it as a Unity project
# and will delegate to the restricted subagents (rather than refusing / doing the
# work itself). No real Unity install is needed — the bridge is the fixture.
# Keep the canonical Unity markers (ProjectSettings/ProjectVersion.txt + an empty
# Assets/Scenes/ dir + AGENTS.md) so the PRIMARY agent recognizes a Unity project
# and delegates. Deliberately DO NOT seed a readable .unity scene file: the
# restricted subagent must enumerate scenes through the bridge's scene_list, not by
# reading the filesystem. (An earlier seeded Main.unity let the subagent answer from
# a `read` instead of driving the bridge.)
mkdir -p "$SBX_PROJECT/Assets/Scenes" "$SBX_PROJECT/ProjectSettings"
printf 'm_EditorVersion: 2022.3.10f1\n' > "$SBX_PROJECT/ProjectSettings/ProjectVersion.txt"
cat > "$SBX_PROJECT/AGENTS.md" <<'A'
# Unity Project (QA fixture)
This is a Unity project. Unity editor work is driven ONLY through the Unity SuperMCP
bridge via the restricted `unity-*` subagents (e.g. `task(subagent_type="unity-scene", ...)`).
The bridge is running for this session. Delegate Unity scene/editor requests to the
matching restricted subagent directly. Do NOT read scene files off disk to answer
Unity queries — the bridge is authoritative.
A

echo "[setup-sandbox] project: $SBX_PROJECT"
echo "[setup-sandbox] skills:  $SBX_SKILLS"
echo "[setup-sandbox] agents:  $(ls "$SBX_PROJECT/.opencode/agents" | tr '\n' ' ')"
