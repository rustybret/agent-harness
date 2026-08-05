# Task 5 Evidence — Option A restricted `unity-editor.md` agent

## What was tested
Creation of `.opencode/agents/unity-editor.md` — the Option A restricted, fast
Unity editor task-executor subagent (native OpenCode markdown agent). Verified:
1. Frontmatter parses as YAML.
2. Permission map matches the plan spec byte-exactly.
3. No forbidden frontmatter keys (`hidden`, deprecated `tools:`, fabricated
   `allowed_tools`/`auto_load_skills`).
4. Body contains the required discipline sections.
5. Body contains ZERO instruction to use the filesystem/shell tools
   (`bash`, `edit`, `write`, `aft_*`).

## What was observed

### Frontmatter parse + permission map (js-yaml)
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
```
- `PERMISSION_EXACT_MATCH: true` against
  `{"*":"deny", skill:"allow", skill_mcp:"allow", read:"allow", question:"allow", todowrite:"allow"}`.
- `hidden: undefined` (key absent) — satisfies "No `hidden: true`".
- `tools_key: false` — deprecated `tools:` key absent.
- No `todoread` rule (that tool does not exist in OpenCode; would be dead config).
- No `allowed_tools` / `auto_load_skills` fabricated keys.
- `"*": deny` is written FIRST so the per-tool `allow` rules win under
  OpenCode's last-match-wins permission precedence
  (`opencode/packages/core/src/v1/config/permission.ts:17-41`,
  `propertyOrder: "original"`).

### Body content (present)
- Identity — restricted subagent; all Unity touchpoints via bridge tools through
  `skill_mcp`; no filesystem, no shell.
- Domain Selection — a `Domain:` line drives a load of exactly ONE skill, via a
  six-row mapping table:
  scene→unity-scene, script-roslyn→unity-script-roslyn, asset→unity-asset,
  build→unity-build, runtime→unity-runtime, bridge-bootstrap→unity-bridge-bootstrap.
- Blocked-on-ambiguous-domain rule — missing/ambiguous `Domain:` → return
  `Status: blocked` naming candidate domains, without loading any skill, never guess.
- Post-load grounding — `bridge_status` first, then
  `get_relevant_tools(role="<domain>")` (128-tool client cap; 153 live tools).
- Compile gate — after `script_create`/`script_edit`, poll `compile_status`
  until succeeded/failed; read `compile_errors` on failure; never report success
  on a write alone.
- Modal flow — `list_pending_modals` → `dismiss_modal`; `bridge_safe_mode_check`
  for safe-mode/compiler dialogs; `unity-modal-dismiss` skill ONLY as last resort
  for OS-level dialogs.
- Idempotency — safe tools retry freely; unsafe tools confirm-before-retry;
  `session_changes` for the mutation log.
- Structured output block — Status (done|blocked|needs-decision), Summary,
  Changes, Verification (with compile job ids), Blockers.

### Grep for forbidden harness tools
`grep -nE '\b(bash|edit|write|aft_search|aft_outline)\b'` on the file returns
exactly two lines, BOTH false positives — NEITHER instructs use of a harness tool:
- Line 2 (frontmatter description): the word `build` inside the Unity domain list
  `scene|script-roslyn|asset|build|runtime|bridge-bootstrap`, and "no bash" as a
  restriction statement.
- Line 80: "NEVER report success on the strength of a **write** alone" — the
  English verb describing a bridge script write, not the `write` tool.

A stricter grep for `aft_` matched nothing. There is NO instruction anywhere in
the body to use `bash`, `edit`, `write`, or `aft_*`. The only mentions of these
words are negations/restrictions or the "build" Unity domain / "write" English verb.

## Why this is enough
The four expected-outcome gates are all satisfied and machine-verified:
- File created at the exact path.
- Frontmatter parses; permission map is byte-exact to spec (allow set = skill,
  skill_mcp, read, question, todowrite; everything else denied via `"*": deny`).
- Body carries every required section: domain→skill table, blocked-on-ambiguous
  rule, compile gate, modal-dismiss-as-last-resort, idempotency, structured
  output.
- Forbidden-tool grep yields zero real instructions.
Discipline text was adapted from `.opencode/agents/unity-gamedev.md` (the
already-remediated unrestricted agent), with all filesystem-tool references
stripped for this restricted variant. Live-harness registration/permission-denial
QA is deferred to plan todos 9 and 10 (sandbox), per the plan's verification
strategy — not in scope for this authoring todo.

## What was omitted
- No live opencode session was spawned (registration + permission-denial proof is
  todos 9/10's sandbox QA). This todo is authoring-only.
- No secrets, tokens, or env dumps involved; nothing redacted.
- Sibling Option B agent files (todos 6, 7) were not touched — they are built
  concurrently against the same template by parallel tasks.
