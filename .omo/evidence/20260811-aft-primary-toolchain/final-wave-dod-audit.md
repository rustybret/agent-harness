# Final Wave DoD Audit: AFT Primary Toolchain Migration

## DoD-1 (Tooling & Registration): APPROVE
- `createBuiltinMcps()` in `packages/omo-opencode/src/mcp/index.ts` no longer registers/spawns `lsp`. (Verified via `cat packages/omo-opencode/src/mcp/index.ts`)
- `McpNameSchema` in `packages/omo-opencode/src/mcp/types.ts` no longer lists `"lsp"` as active. (Verified via `cat packages/omo-opencode/src/mcp/types.ts`)
- `packages/omo-opencode/src/mcp/lsp.ts` and `lsp.test.ts` are deleted. (Verified via `ls`)
- `packages/omo-opencode/src/cli/doctor/checks/tools-lsp.ts` and `tools-lsp.test.ts` are deleted. (Verified via `ls`)

## DoD-2 (Prompts & Personas): REJECT
- `packages/omo-opencode/src/agents/explore.ts` still contains `lsp_` tool references.
  - Line 30: `["lsp_symbols", "lsp_goto_definition", "lsp_find_references", "lsp_diagnostics"]`
  - Line 110: `- **Semantic search** (definitions, references): LSP tools`
- `packages/prompts-core/prompts/atlas/` and `packages/prompts-core/prompts/ultrawork/` have 0 hits for `lsp_` tools.

## DoD-3 (Evidence & Quality Gates): REJECT
- `aft_inspect` is present in `AGENTS.md` (line 156) but only as a mention in the toolset note, not as a post-edit diagnostic gate.
- `aft_inspect` is completely absent from `packages/omo-opencode/src/AGENTS.md`.
- "AFT status-bar headers" is completely absent from both `AGENTS.md` and `packages/omo-opencode/src/AGENTS.md`.
- `lsp_diagnostics` is absent from both files (which is correct, but the required new instructions are missing).

## DoD-4 (Documentation): APPROVE
- `docs/reference/aft-primary-toolset.md` exists and is substantive (54 lines).
- Covers Discovery -> Structure -> Zoom -> CallGraph -> Refactor -> Safety -> Inspect sequences (lines 28-39).
- Covers `~/.config/cortexkit/aft.jsonc` config guidance (lines 40-50).
- Covers remote VM/Unity SuperMCP bridge exceptions (lines 52-54).

## Scenario 3 Audit: REJECT
- `grep -rn "lsp_diagnostics" packages/prompts-core/ packages/omo-opencode/src/agents/` returns 1 hit in `packages/omo-opencode/src/agents/explore.ts:30`.

## Additional Adversarial Checks
- `lsp-daemon` and `lsp-tools-mcp` packages are legitimately retained for Codex Light edition compatibility, as documented in the `AGENTS.md` invariants. These are correctly distinguished from the deprecated interactive `lsp_*` tools.
