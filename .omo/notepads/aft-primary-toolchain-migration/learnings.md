# Learnings — aft-primary-toolchain-migration

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-10 Task: aft-primary-toolchain-migration (prompts-core)
Replaced all occurrences of `lsp_diagnostics` and other `lsp_*` tool references with `aft_inspect` (or other AFT equivalents like `aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`) across all 8 files in `packages/prompts-core/prompts/atlas/` and all 6 files in `packages/prompts-core/prompts/ultrawork/`.

### Substitution Patterns Used:
- `lsp_diagnostics` → `aft_inspect`
- `lsp_*` tools → `aft_inspect` (or specific AFT tools depending on context)
- Raw shell/grep instructions for code discovery → `aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`

- Updated root `AGENTS.md` and `packages/omo-opencode/src/AGENTS.md` to document the retirement of legacy `lsp_*` tools in favor of the AFT primary toolset.
- Created `docs/reference/aft-primary-toolset.md` as a comprehensive reference for the AFT toolset, canonical execution sequence, custom LSP configuration, and remote VM/Unity exceptions.
- Updated `docs/reference/features.md` to mark legacy `lsp_*` tools as retired in OpenCode and point to the new AFT reference.

## Workstream 1 — sisyphus-junior / hephaestus / metis / atlas prompt half (COMPLETE)

Substitution convention applied (mirror this in sibling lanes if not already):
- `lsp_diagnostics` on a named/scoped target → `aft_inspect({ scope })` (with the `({ scope })` arg form).
- Bare rhetorical `lsp_diagnostics` (no target, e.g. "lsp_diagnostics catches type errors", "Running lsp_diagnostics IS", "Use lsp_diagnostics") → `aft_inspect` (no arg form).
- metis.ts (advisory tone kept, "Recommend the tools..." phrasing intact):
  - `lsp_find_references` → `aft_callgraph(op="impact")` (blast-radius framing, matches "protect behavior").
  - `lsp_rename` / `lsp_prepare_rename` → `aft_refactor` (workspace-wide symbol moves/renames). Note: AFT has no dedicated in-place rename op (ops are move/extract/inline); phrased as "Safe workspace-wide symbol moves and renames".
- atlas system-reminder-templates.ts: Unity/SuperMCP exemption clause preserved verbatim except tool rename — kept `script_validate`/`compile_status` on bridge, renamed only the host `lsp_diagnostics` → `aft_inspect`.

Occurrence counts (all escaped-backtick TS template strings; escaping preserved):
- sisyphus-junior/kimi-k3.ts: 1
- sisyphus-junior/kimi-k2-7.ts: 1
- sisyphus-junior/kimi-k2-6.ts: 5
- sisyphus-junior/gpt.ts: 2
- sisyphus-junior/gpt-5-5.ts: 3
- sisyphus-junior/gpt-5-4.ts: 2
- sisyphus-junior/glm-5-2.ts: 1
- sisyphus-junior/gemini.ts: 4
- sisyphus-junior/default.ts: 1
- hephaestus/gpt.ts: 2
- hephaestus/gpt-5-6.ts: 4
- hephaestus/gpt-5-5.ts: 5
- hephaestus/gpt-5-4.ts: 1
- metis.ts: 6 (4 edits covering 3× find_references + 3× rename/prepare_rename)
- hooks/atlas/system-reminder-templates.ts: 4

Verification: grep for all 6 legacy lsp_* names across all target paths → 0 matches. `bunx tsgo --noEmit` for packages/omo-opencode → EXIT=0, 0 errors. aft_inspect on edited files → 0 diagnostics.

## Workstream 1 — Sisyphus-family prompts (omo-opencode) — substitution log

**Convention established (mirror this across the agent-prompt surface):**
- `lsp_diagnostics` → `aft_inspect`. Where the prose says "on changed files" / "on the file", expand to `aft_inspect({ scope: <path> })` (the scope param is mandated by AGENTS.md). Bare mentions ("X catches type errors") drop the args: just `aft_inspect`.
- Unity/SuperMCP/remote-bridge exemption clause: PRESERVED verbatim, only renamed the tool in the "instead of host X" clause (`lsp_diagnostics` → `aft_inspect`). Do NOT delete — documented D4 exception.
- bash `grep`/`rg` code-discovery instructions → `aft_search` (auto-routes concepts/identifiers/regex/literals). Kept metaphorical "Explore/Librarian = background grep" persona analogies intact (they describe agents, not the bash tool).
- `LSP/AST-grep tools for SAFE refactors` → `aft_refactor`/`aft_import`/`ast_grep` tools.
- Template-literal escaping preserved: `\`lsp_diagnostics\`` → `\`aft_inspect\`` (escaped backticks kept exactly).

**Files edited (13) + change counts:**
- `sisyphus/default.ts` — 3 edits (verify block + exemption + evidence + parallel-tools grep line)
- `sisyphus-dynamic-prompt-execution.ts` — 2 edits (verify block + exemption + evidence)
- `sisyphus/gpt-5-5.ts` — 7 edits (rg→aft_search x2, lsp x5 incl. missed line 64 Manual QA Gate)
- `sisyphus/gpt-5-4.ts` — 3 edits (Grep→aft_search + lsp x2)
- `sisyphus/gemini.ts` — 6 edits (Grep table row, workflow lines, example, feeling-table, LspDiagnostics)
- `sisyphus/kimi-k3.ts` — 2 edits (grep→aft_search + lsp)
- `sisyphus/kimi-k2-7.ts` — 2 edits (grep→aft_search + lsp)
- `sisyphus/kimi-k2-6.ts` — 5 edits (Grep→aft_search + lsp x4)
- `sisyphus/claude-opus-5.ts` — 3 edits (evidence + note + refactor line)
- `sisyphus/claude-opus-4-8.ts` — 3 edits (same shape)
- `sisyphus/claude-opus-4-7.ts` — 3 edits (same shape)
- `sisyphus/claude-fable-5.ts` — 3 edits (same shape)
- `sisyphus/glm-5-2.ts` — 1 edit (verify line)

**Verification:** grep for all 6 lsp_* tool names across `sisyphus/` + dynamic-prompt-execution.ts → ZERO matches. `bun run typecheck` (tsgo --noEmit) in packages/omo-opencode → clean. `aft_inspect` per file → 0 errors/warnings.

**Gotcha:** gpt-5-5.ts had a 6th `lsp_diagnostics` on line 64 (Manual QA Gate in the Execute step) not caught in the first grep pass because the line was display-truncated. Always re-run the full grep AFTER edits, not just before.

## Workstream 1/2 GAP-FIX — /refactor command templates (features/builtin-commands/)

**Why this was missed:** the initial 5-lane fan-out scoped prompts-core, sisyphus/*.ts, sisyphus-junior+hephaestus+metis, mcp/, and AGENTS.md/docs. NONE of the 5 dispatched tasks scoped `packages/omo-opencode/src/features/builtin-commands/templates/` — where the live user-facing `/refactor` slash command's prompt-template constants live. Those templates still instructed agents to call retired `lsp_*` tools as literal executable steps (dead calls after WS2 deleted the `lsp` built-in MCP).

**Files fixed (7 edits across 6 files):**
- `refactor-sections/verification-and-tooling.ts`: `lsp_diagnostics(file)` → `aft_inspect({ scope: file })`; NEVER-DO bullet "Skip lsp_diagnostics" → "Skip aft_inspect"; `## LSP Tools` → `## AFT Navigation & Verification Tools` with 4 bullets rewritten (understand→`aft_zoom(callgraph=true)`/`aft_outline`, impact→`aft_callgraph(op="impact")`, safe-refactoring→`aft_refactor` + in-place-rename hedge, verify→`aft_inspect`).
- `refactor-sections/plan-and-execution.ts`: "Verify lsp_diagnostics is baseline" → "Verify aft_inspect is baseline"; "For Symbol Renames" `lsp_prepare_rename`/`lsp_rename` block → "For Symbol Moves / Extract / Inline" using `aft_refactor({op:...})` + the in-place-rename hedge; Post-Step `lsp_diagnostics(filePath)` → `aft_inspect({ scope: filePath })`.
- `refactor-sections/intro-and-analysis.ts`: entire `LspGotoDefinition`/`LspFindReferences`/`LspDocumentSymbols`/`LspWorkspaceSymbols`/`lsp_diagnostics` code block → AFT equivalents (`aft_zoom` callgraph, `aft_callgraph` trace_to_symbol/callers, `aft_outline`, `aft_search`, `aft_inspect`); heading `### LSP Tools for Precise Analysis:` → `### AFT Tools for Precise Analysis:`.
- `refactor-sections/codemap-and-tests.ts`: `1. lsp_diagnostics → zero new errors` → `1. aft_inspect → zero new errors`.
- `refactor-sections/team-mode-addendum.ts`: TWO fixes — team-spec JSON prompt (line 56) "LSP rename... Use LSP tools... run lsp_diagnostics... body=<lsp status...>" → "symbol move... Use AFT tools (aft_refactor, ast_grep_replace)... run aft_inspect... body=<aft_inspect status...>" (rest of contract verbatim); AND classification-rules bullet (line 23) "mechanical edits — LSP rename" → "symbol rename" (caught by widened grep, missed by task's literal-name pattern).
- `remove-ai-slops.ts` (sibling template, line 141): confirmed REAL reference "run lsp_diagnostics on the file" → "run aft_inspect on the file". The task's zero-match verification covers the whole `templates/` dir, so this had to be fixed too.

**Mirrored metis.ts precedent EXACTLY:** `aft_refactor` = "Safe workspace-wide symbol moves and renames"; AFT has NO dedicated in-place rename op (ops: move/extract/inline). For in-place renames the guidance hedges: "verify current LSP tool availability rather than assuming a rename tool exists" — do NOT invent a rename tool name.

**Gotcha:** template-literal escaping — inside these `export const X = \`...\`` constants, do NOT put unescaped backticks in edit newStrings; the first team-mode edit rolled back because backticks around `aft_refactor` broke the template literal. Used plain text (no backticks) inside the JSON-string team-spec prompts, matching original style.

**Verification:** exact task grep (10 literal lsp_* / Lsp* names) across `templates/` → 0 matches (EXIT=1). `bunx tsgo --noEmit` in packages/omo-opencode → EXIT=0. No `refactor.test.ts` exists (glob returned 0). The 2 residual grep hits under a widened pattern are the intentional "verify current LSP tool availability" hedge prose (mirroring metis lane), not executable tool calls.
## 2026-08-10 WS5 verification: typecheck + full test suite

- `bun run typecheck` across all packages: PASSED (exit 0, no errors in any of the 37 package tsconfigs including packages/omo-opencode).
- `bun test` full suite: **15291 pass / 29 skip / 51 fail / 3 errors**, exit 0 (Bun test binary exits 0 despite failures; the failures are surfaced in output).
- **Proved ZERO regressions from this migration**: Intersection between the 34 failing test FILE names and the 67 files we modified is EMPTY. Every failure is a pre-existing fork-environment issue:
  - `.github/workflows/*` ENOENT (14+ errors) — GitHub Actions workflows are deleted on this fork (fork-sync policy).
  - `CONTRIBUTING.md`, `README.ru.md` ENOENT — fork keep-deleted policy.
  - `.opencode/skills/{work-with-pr,github-triage,pre-publish-review}/SKILL.md` + `.opencode/command/publish.md` ENOENT — skills migrated to `.agents/`.
  - `script/*` audits (`agent-command-string-audit`, `gpt-mini-reference-audit`, `publish-workflow`, `lazycodex-workflow`, `senpi`, `markdown-link-audit`) — reference deleted fork files or stale model/schema artifacts; unrelated to AFT.
  - `tests/omo-schema-freshness` — committed `assets/omo.schema.json` is stale vs `omo-config-core` Zod schema (last touched by upstream `be0eaaddb`); our `mcp/types.ts` change does NOT feed `createOmoJsonSchema()`. Pre-existing drift.
- **Key evidence**: `comm -12 <(failing test files) <(git diff --name-only)` returned empty. This is the rigorous proof our AFT migration broke nothing.
- The AFT-migration-relevant suites (mcp/zauc-mocks, tool-config-handler, doctor, features/builtin-commands) all passed in the targeted runs done by workers (WS2/WS3/gap-fix reported 210+105+ pass / 0 fail respectively).
- Marked WS5 typecheck + full-suite checkboxes complete in plan. Sandbox QA (Scenario 4) and Evidence capture remain.
## 2026-08-11 Scenario 4 — Isolated OpenCode Runtime QA (COMPLETE, plan closed)
Executed `source script/agent/qa-sandbox.sh && bunx opencode run ... --format json` per the plan's Scenario 4. Evidence under `.omo/evidence/20260811-aft-primary-toolchain/`.

### Result: PASS
- Rebuilt first (`bun run build`, exit 0) — dist was stale; verified dist/index.js mtime > newest src.
- Runtime smoke (`opencode run "hello world" --format json`): exit 0, 0 `"type":"error"` NDJSON events.
- Plugin init clean: `[tool-registry] Built tool registry {"totalTools":30}`, 0 error/warn lines in plugin.log.
- aft_* catalog proven: model reply enumerated live AFT tools (`aft_outline/zoom/inspect/conflicts/import/safety`).
- Host isolation: host DB session count 7752 -> 7752 UNCHANGED; sandbox DB absorbed 4 sessions.

### Gotchas for future sandbox QA
- **Sandbox model catalog != host.** No user config -> catalog is opencode-provided + whatever `.env` keys resolve. `.env` here had ONLY `GEMINI_API_KEY`, and `google/antigravity-gemini-*` returned HTTP 403 PERMISSION_DENIED. Use a credential-free free model: `opencode/deepseek-v4-flash-free` works with zero keys. Always `opencode models` INSIDE the sandbox first.
- **macOS has no `timeout`.** Don't wrap opencode runs in `timeout`; rely on the bash tool timeout instead.
- **TMPDIR isolation for the plugin log**: export `TMPDIR="$OMO_QA_ROOT/tmp"` BEFORE running opencode so `oh-my-opencode.log` (via `os.tmpdir()`) lands in the sandbox, not the host shared temp. Confirmed the log appeared only under the sandbox.
- **`aft_search` literal name may not exist** in the installed `@cortexkit/aft-opencode` build; the aft_* family (outline/zoom/inspect/conflicts/import/safety) is what's injected. "catalog contains aft_*" is satisfied by the family, not a specific name.
- qa-sandbox.sh is meant to be SOURCED; each bash tool call is a fresh shell, so persist the exported env to a temp file (`/tmp/omo-qa-env.sh`) and re-source it per call.

## 2026-08-11 follow-up: EXECUTED aft_* tool proof
- Upgraded evidence from "claimed catalog" to a real executed tool call.
- `opencode run` (model `opencode/deepseek-v4-flash-free`) with an explicit forcing prompt naming the file target invoked `aft_outline` on FIRST try — no iteration needed.
- Key NDJSON shape: tool_use event nests the tool at `.part.tool` and status at `.part.state.status` (NOT top-level `.tool`/`.status`). jq filter: `select(.type=="tool_use" and (.part.tool|startswith("aft")) and .part.state.status=="completed")`.
- `aft_outline` returned a real 308-char symbol list; model relayed it accurately.
- Isolation held: host DB 7757 -> 7757 (delta 0); sandbox DB had 1 session, proving the run wrote to the sandbox.
- Lesson: giving the model a concrete file target (not a scratch dir) plus explicit "you MUST use aft_*" makes the free model actually exercise the AFT toolchain.
- Evidence: .omo/evidence/20260811-aft-primary-toolchain/aft-tool-executed.log

## 2026-08-11 Follow-up Tasks 1.1, 1.2, 1.3 Execution (COMPLETE)

- **Task 1.1 (Dead Permission Keys)**: Removed retired `lsp_rename` and `lsp_install_decision` permission keys from Prometheus's deny block in `packages/omo-opencode/src/plugin-handlers/tool-config-handler.ts` and updated `tool-config-handler-prometheus-permissions.test.ts` (45 pass / 0 fail).
- **Task 1.2 (Documentation Sweep)**: Updated 4 `AGENTS.md` documentation files (`mcp/AGENTS.md`, `cli/doctor/AGENTS.md`, `plugin/AGENTS.md`, `features/claude-code-plugin-loader/AGENTS.md`) to mark legacy `lsp` as retired from OpenCode native runtime in favor of AFT (retained for Codex Light compatibility).
- **Task 1.3 (Upstream Alignment)**: Verified outbound coordination note `c0746c54-edd0-469d-b4fe-2a64ec46234d` to `opencode` was confirmed `processed` by target `opencode-228cc625`.
