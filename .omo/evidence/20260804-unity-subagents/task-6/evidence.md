# Task 6 Evidence — Option B agents (1/2): unity-scene, unity-script-roslyn, unity-asset

Date: 2026-08-04
Files created:
- `.opencode/agents/unity-scene.md`
- `.opencode/agents/unity-script-roslyn.md`
- `.opencode/agents/unity-asset.md`

## What was tested

1. YAML frontmatter parses for all three files.
2. The config portion of the frontmatter (`mode`, `model`, `temperature`,
   `permission`) is byte-identical across all three files (only `description`
   differs per agent).
3. Each body always loads exactly ONE fixed skill as its first action — no
   domain-selection logic (unlike the domain-selecting `unity-editor` sibling).
4. Each body carries an out-of-domain rule: a task needing another domain
   returns `Status: blocked` naming the correct agent and never loads a second
   skill.
5. No body instructs use of the harness `bash`, `edit`, `write`, or `aft_*`
   tools.

## What was observed

### 1. YAML parse — all OK
```
=== unity-scene ===        yaml-parse: OK
=== unity-script-roslyn === yaml-parse: OK
=== unity-asset ===        yaml-parse: OK
```

### 2. Byte-identical config block (diff proof)
Extracted `mode:` through the closing `---` from each file and diffed:
```
--- scene vs script-roslyn ---
IDENTICAL
--- scene vs asset ---
IDENTICAL
```
Shared block (identical in all three):
```
mode: subagent
model: opencode/gemini-3.5-flash-lite
temperature: 0.1
permission:
  "*": deny
  skill: allow
  skill_mcp: allow
  read: allow
  question: allow
  todowrite: allow
---
```
This matches todo-5's `unity-editor.md` spec exactly: `"*": deny`,
`skill: allow`, `skill_mcp: allow`, `read: allow`, `question: allow`,
`todowrite: allow`; `mode: subagent`; `model: opencode/gemini-3.5-flash-lite`;
`temperature: 0.1`. Only `description` differs per agent.

Per-agent descriptions (headline tools named as required):
- unity-scene: ~36 scene/GameObject/prefab/tilemap/hierarchy/spatial tools
  (scene_*, gameobject_*, prefab_*, component_*, hierarchy_*, ui_find/ui_snapshot,
  raycast, check_line_of_sight, detect_visible_objects/camera_visibility,
  navmesh_query_path).
- unity-script-roslyn: script_create/script_edit/script_validate/script_delete +
  compile gate + test_run (test_run_start/test_run_result).
- unity-asset: asset_*/material_* + reserialize/reserialize_status + UXML/USS
  (ui_*).

### 3. Single-skill-load rule (one fixed skill, no domain selection)
```
=== unity-scene ===        skill-load-first: 1   get_relevant_tools(role="scene")
=== unity-script-roslyn === skill-load-first: 1   get_relevant_tools(role="scripting")
=== unity-asset ===        skill-load-first: 1   get_relevant_tools(role="asset")
```
Each "First Action (ALWAYS)" section loads exactly one skill
(`skill(name="unity-scene"|"unity-script-roslyn"|"unity-asset")`) as the first
action, then `bridge_status` + `get_relevant_tools(role=...)`. No `Domain:` line
parsing anywhere (that belongs to the domain-selecting `unity-editor` sibling).

### 4. Out-of-domain blocked rule
```
=== unity-scene ===        out-of-domain blocked rule: 1
=== unity-script-roslyn === out-of-domain blocked rule: 1
=== unity-asset ===        out-of-domain blocked rule: 1
```
Each has an "## Out-of-Domain Rule" section: task needing another domain →
`Status: blocked` naming the correct agent (unity-scene / unity-script-roslyn /
unity-asset / unity-build / unity-runtime / unity-bridge-bootstrap), with the
explicit "**never load a second domain skill**" guard.

### 5. Forbidden-tool grep (bash / edit / write / aft_) — clean
Grep for `aft_|interactive_bash|\bbash\b|\bedit\b|\bwrite\b|\bglob\b|\bgrep\b`:
```
=== unity-scene ===
86:  log; do not assert success from a write call alone.
93:- C# script create/edit/validate/delete, compile gate → `unity-script-roslyn`
=== unity-script-roslyn ===
2:description: ... Roslyn pre-flight validation before every write ...
46:### Roslyn Pre-flight (do this before every write)
51:- If the dotnet validator returns errors, the write is blocked with
53:- When the validator is not found, the write proceeds anyway (graceful
75:  on the strength of a write alone.
=== unity-asset ===
65:  normalize ... after an external edit
74:- The bridge guards against clobbering externally changed files. A write to a
75:  file changed on disk between read and write returns `external_change_detected`
94:  log; do not assert success from a write call alone. For a reserialize job,
103:- C# script create/edit/validate/delete, compile gate → `unity-script-roslyn`
```
Every hit is natural-language prose ("a write call", "external edit", the
out-of-domain routing line "script create/edit/validate/delete") or the
`script_*` compile-gate description — NONE is an instruction to use the harness
`bash`, `edit`, `write`, or `aft_*` tools. No `aft_`, no `interactive_bash`, no
`bash` tool reference appears in any body.

## Why it is enough

The three deliverables are static agent-definition markdown consumed by the
OpenCode agent loader (`.md` frontmatter is the only format read, per todo-4).
Correctness is fully determined by: (a) frontmatter parses, (b) config block
byte-identical to the shared template, (c) the body structure (single-skill
load, bridge_status + get_relevant_tools, domain discipline, structured output,
out-of-domain rule), and (d) absence of forbidden-tool instructions. All four
are proven above via YAML parse, diff, and grep. No live harness run is required
because these files add no runtime code path — they are declarative config.

## What was omitted

No secrets, tokens, env dumps, or auth material are involved. The bridge URL
`http://127.0.0.1:27182/mcp` lives only inside the vendored skill frontmatter
(not these agents) and is a loopback dev address, not a credential.
