# Task 9 — Sandbox QA: registration, permission enforcement, dispatch behavior

Plan: `.omo/plans/unity-supermcp-subagents.md` todo 9. QA-only; zero code changes.
Verified against opencode **v1.18.11** (bun 1.3.12, macOS), plugin build `dist/index.js`
(2026-08-04 18:31). Isolation follows `opencode-qa` / `qa-sandbox.sh` conventions:
every spawned opencode ran under a fresh `mktemp` XDG sandbox with its own empty DB;
the real `~/.local/share/opencode/opencode.db` was only ever read.

---

## WHAT WAS TESTED

Three probe groups against restricted Unity subagents dispatched in this repo as the
project dir, plus a static permission cross-check:

- **(a) REGISTRATION + PERMISSION** — isolated `opencode serve`, bootstrap
  `GET /agent?directory=<repo>` (lazy plugin init, memory #2092), capture the full
  `/agent` JSON; assert all 8 unity agents register non-hidden and each restricted
  agent's effective permission map matches the todo-5/6/7 spec.
- **(b) DENIAL** — real `task(subagent_type="unity-editor")` dispatch instructed to run
  `bash`; assert bash is rejected by the permission map (not executed).
- **(differential)** — the SAME bash instruction via `task(subagent_type="unity-gamedev")`
  (unrestricted control); assert bash IS executed.
- **(c) DISPATCH MODE** — assert the gemini-flash-lite `task(subagent_type="unity-editor")`
  completes in SYNC mode (or document forced-background if it applied).

Raw artifacts live under `raw/`. Driver scripts (gitignored) under
`.local-ignore/qa/unity-task9/`.

---

## WHAT WAS OBSERVED

### Isolation proof (real DB untouched)

- Real DB: `/Users/brethoffman/.local/share/opencode/opencode.db`
  (`raw/real-db-session-count-BEFORE.txt` = **7023**, `...-AFTER.txt` = **7052**).
- The +29 delta is **ambient**: this QA runs inside a *live* opencode session that writes
  to the real DB (plus other machine activity). It is NOT from the probes.
- **Direct isolation proof** (`raw/` DB queries): every one of my 6 probe sessions
  (titles "Task tool with unity-editor subagent", "Unity-gamedev shell execution",
  "Subagent tool availability test", "Run ls -la via unity-editor", …) returns **0 rows**
  in the real DB and **is present** only in the sandbox mktemp DBs. The isolated sandboxes
  never wrote to the real DB.

### (a) Registration + permission — PASS

- `raw/agent-names.txt`: all 8 unity agents registered — `unity-editor`, `unity-scene`,
  `unity-script-roslyn`, `unity-asset`, `unity-build`, `unity-runtime`,
  `unity-bridge-bootstrap`, `unity-gamedev`. Each `present=1 hidden=unset` (none hidden).
- `raw/effective-permissions.txt`: last-match-wins evaluation of the `/agent` permission
  array. **All 7 restricted agents match the spec EXACTLY**:

  | tool | effective | expected |
  |---|---|---|
  | `*` | deny | deny |
  | skill | allow | allow |
  | skill_mcp | allow | allow |
  | read | allow | allow |
  | question | allow | allow |
  | todowrite | allow | allow |
  | bash | deny | deny |
  | edit | deny | deny |
  | write | deny | deny |
  | task | deny | deny |
  | webfetch | deny | deny |
  | websearch | deny | deny |

  Overall: `ALL RESTRICTED AGENTS MATCH SPEC`. All 7 run
  `mode=subagent, model=opencode/gemini-3.5-flash-lite`.
- Control `unity-gamedev`: `*`=allow, bash/edit/write=allow (unrestricted),
  model `anthropic/claude-sonnet-4-6`.
- Full permission JSON: `raw/agent-list.json` (530 KB) + `raw/agent-permission-maps.json.txt`.

### (b) Denial + (differential) — PASS

The restricted `permission` map is a **subagent-dispatch-time** control, enforced only via
`task(subagent_type=...)`, not via `opencode run --agent` primary mode
(see `raw/NOTE-primary-vs-subagent.txt`).

- **unity-editor child** (agent=unity-editor, gemini-flash-lite), blunt "call bash `ls -la`"
  prompt → the subagent **self-reports bash unavailable** (`raw/denial-child-available-tools.txt`):

  > "The `bash` tool is not available in my tool definitions.
  > Here are the tools currently available to me: call_omo_agent,
  > list_mcp_resource_templates, list_mcp_resources, read, read_mcp_resource,
  > skill, skill_mcp, todowrite"

  **Zero** bash tool-call parts in the child session (sandbox DB query). The deny-listed
  tools (bash/edit/write/task/webfetch/websearch) are stripped from the child toolset
  before the model sees them — enforcement mechanism:
  `sync-prompt-sender.ts:53-70 buildSyncPromptTools()` maps each deny-tool to `false`.

- **unity-gamedev child** (unrestricted control), SAME bash instruction →
  bash tool part `status=completed`, output `total 1688 / drwxr-xr-x … .agents …`
  (`raw/task-differential-unity-gamedev.jsonl`, child session in sandbox DB). Bash EXECUTED.

  → The restriction is **agent-specific** (the permission map), not sandbox-wide.

### (c) Dispatch mode — SYNC (flash-lite NOT forced to background)

- **Observed:** every `task(subagent_type=…)` dispatch returned an in-band header
  `Task completed in <N>s` with the subagent output inline — never
  `Background task launched.` The parent `opencode run` returned only after the child
  finished. Routing line confirms `opencode/gemini-3.5-flash-lite`.
  (`raw/dispatch-mode-finding.txt`, headers quoted from all three probe transcripts.)
- **Code-path proof:** `delegate-task/tools.ts:156-222` — forced-background is gated on
  `if (delegateTaskArgs.category)` and only fires for the CATEGORY path
  (`isUnstableAgent && isRunInBackgroundExplicitlyFalse` → `executeUnstableAgentTask`).
  The `subagent_type` path is the `else` (line 196) → `executeSyncTask` (line 222) with
  no unstable-agent detection. `isUnstableTask()` flags gemini models but is only consulted
  on the category path. So subagent_type dispatch of a gemini agent stays SYNC.
- **Accepted behavior** for task-12 docs; `packages/model-core/` untouched.

---

## WHY IT IS ENOUGH

- Registration + the effective permission map are read from opencode's own `/agent` API
  (its authoritative resolved config), and evaluated with the real last-match-wins
  algorithm — not paraphrased from the `.md` frontmatter. All 7 restricted agents pass
  every one of the 12 asserted tool resolutions.
- Denial is proven at the real enforcement layer (subagent dispatch) two independent ways:
  the child's own tool-definition self-report AND zero bash parts in the child session DB.
  The unrestricted control executing the identical instruction isolates the cause to the
  permission map.
- Dispatch mode is proven both empirically (sync headers in three live runs) and by the
  exact routing code, so the conclusion is not model-luck.
- Isolation is proven by direct evidence (probe sessions absent from the real DB, present
  in sandbox DBs), which is stronger than the raw before/after count given ambient writes.

## WHAT WAS OMITTED

- No live Unity Editor / SuperMCP bridge (port 27182 never bound). `skill_mcp` bridge calls
  returned "No Unity Editor instance is registered" — expected; bridge behavior is out of
  scope for todo 9 (deferred to the gated benchmark, todo 11).
- Raw `/agent` JSON contains sandbox-local absolute paths and provider names only; no auth
  tokens/secrets are copied into evidence (auth.json was copied into the sandbox at runtime,
  never into `raw/`).
- The `opencode run --agent` primary-mode runs (`raw/primarymode-agent-*.jsonl`) are kept
  only as the control showing primary mode does NOT apply the subagent permission map;
  they are not the denial proof.
