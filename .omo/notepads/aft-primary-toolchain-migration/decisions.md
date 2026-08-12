# Decisions — aft-primary-toolchain-migration

Architectural choices and rationales discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-10 Task: Workstream 3 — agent permission boundaries (tool-config-handler.ts)

### Gap check 1 — Prometheus `edit`/`write`: NOT flat-denied (path-gated instead)
- Investigated `packages/omo-opencode/src/hooks/prometheus-md-only/` (hook.ts, constants.ts, path-policy.ts).
- `BLOCKED_TOOLS = ["Write","Edit","write","edit"]` + `PATCH_TOOLS = ["apply_patch"]` are gated in the `tool.execute.before` hook: every write is confined to `.omo/*.md` via `isAllowedFile()` (resolve/relative, workspace-confined, `.md`-only, `.omo` prefix).
- DECISION: Do NOT add a flat `edit`/`write` deny for Prometheus. Prometheus legitimately needs `edit`/`write` for `.omo/plans/*.md` plan files (repo convention). A flat deny would break planning. The plan's "deny edit/write" intent is satisfied by the path-scoped hook — a stronger, file-aware guarantee than a blanket tool deny. Clarified this in the code comment above the Prometheus flat-deny block.

### Gap check 2 — Atlas: added explicit mutation-tool denies (option b)
- Atlas system prompt (`packages/prompts-core/prompts/atlas/default.md`) asserts: "You never write code yourself. You orchestrate specialists who do."
- DECISION: Implemented option (b) — enforce the orchestrator boundary in CODE (stronger than prompt text). Added flat denies to Atlas's permission block: `edit`, `write`, `aft_refactor`, `aft_import`, `aft_move`, `aft_delete`, `aft_safety`, `ast_grep_replace`.
- Read-only sensory/discovery tools (`aft_search`/`aft_outline`/`aft_zoom`/`aft_callgraph`/`aft_inspect`) intentionally left UNLISTED — allow-by-default, needed for surveying work. Documented rationale in an inline comment above the block.
- Locked with a new regression test in `tool-config-handler-prometheus-permissions.test.ts` ("atlas (orchestrator) flat-denies the mutation surface but keeps sensory tools visible").

### Gap check 3 — Sisyphus/Hephaestus: confirmed full mutation access (no change)
- Neither has any deny on `aft_refactor`/`aft_import`/`aft_move`/`aft_safety`/`edit`. Full implicit access preserved (executors need it per plan). No edit made. Existing regression test "sisyphus keeps task allowed and gets no bash/aft denies" already guards this.

### tools/ scan — no `lsp_*` config/allowlist references
- `packages/omo-opencode/src/tools/` has zero `lsp_*` string literals in config/allowlist contexts. Only occurrences are in `tools/AGENTS.md` (docs, owned by sibling doc lane) and `skill/native-skills.ts` `allowedTools` (a passthrough of SKILL.md-declared tool names, not a category tier map). No `DEFAULT_CATEGORIES`/`CATEGORY_MODEL_REQUIREMENTS` entries reference tool names. Nothing to migrate in tools/.

### Dead permission keys — `lsp_rename` / `lsp_install_decision` LEFT IN PLACE
- MCP-cleanup sibling lane has NOT yet retired these tool names: still referenced in `plugin/tool-registry-trimming.ts`, `config/schema/dynamic-context-pruning.ts`, `agents/metis.ts` prompts, and refactor-section templates.
- DECISION: Per task guidance, left Prometheus's `lsp_rename: "deny"` / `lsp_install_decision: "deny"` entries untouched (harmless either way). Follow-up recorded in issues.md.

### Verification
- Baseline: 104 pass / 0 fail across all 4 tool-config-handler test files (before changes).
- After changes: 105 pass / 0 fail (added 1 Atlas regression test, zero regressions).
- `bun run typecheck:packages` — EXIT=0.

## 2026-08-10 Task: WS2 — Retire `lsp` built-in MCP registration (packages/omo-opencode/src/mcp/)

### Decision: fully DELETE, not deprecate
Retired the `lsp` built-in MCP from the OpenCode plugin runtime per plan D1. Deleted (via aft_delete, backups exist):
- `packages/omo-opencode/src/mcp/lsp.ts`
- `packages/omo-opencode/src/mcp/lsp.test.ts`
- `packages/omo-opencode/src/cli/doctor/checks/tools-lsp.ts` (+ `.test.ts`) — see "surprising caller" below.

### `LocalMcpConfig` type relocation
`LocalMcpConfig` was defined in `lsp.ts` but ALSO imported by `codegraph.ts` (the remaining local MCP). Relocated the type definition into `codegraph.ts` (now its owner/exporter) and repointed `mcp/index.ts` to `import { ..., type LocalMcpConfig } from "./codegraph"`. `codegraph.ts` no longer imports from `./lsp`.

### `McpNameSchema` — removed `"lsp"` cleanly (backward-compat safe)
Removed `"lsp"` from `McpNameSchema = z.enum([...])` in `mcp/types.ts`. Verified this does NOT break config backward compatibility: `disabled_mcps` in the config schema validates against `AnyMcpNameSchema` (`z.string().min(1)`), NOT `McpNameSchema`. So an existing config with `disabled_mcps: ["lsp"]` still parses fine (confirmed by `config/schema.test.ts` — 93 pass). Added a code comment documenting this rationale above the enum.

### Also updated (in-scope registration touchpoints)
- `mcp/index.ts`: removed `createLspMcpConfig` import + the `if (!disabledMcps.includes("lsp"))` block.
- `mcp/zauc-mocks-mcp-index/index.test.ts`: removed lsp mock, lsp assertions, the "should keep lsp when it uses a bootstrap command" test, dropped `"lsp"` from the all-disabled array, and removed the lsp-only "resolve enabled local MCP runtime commands" test (codegraph has its own equivalent runtime test, kept).
- `hooks/tool-output-truncator.ts`: swapped `"lsp_diagnostics"` → `"aft_inspect"` in `TRUNCATABLE_TOOLS` (AFT confirmed aft_inspect returns standard JSON; keeps output-size truncation coverage for the replacement diagnostics tool).
- `plugin/tool-registry-trimming.ts`: removed the 6 `lsp_*` entries from `LOW_PRIORITY_TOOL_ORDER` (tools no longer exist to trim).

### Verification
`bun run typecheck:packages` → exit 0. `bun test` on mcp/ + cli/doctor/ + tool-output-truncator + tool-registry-trimming → 210 pass / 0 fail. `cli-suffix.test.ts` untouched (unrelated path-suffix matcher). Vendored `packages/lsp-tools-mcp/` and `packages/lsp-daemon/` left intact (out of scope).
