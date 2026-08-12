# AFT Primary Toolchain Migration & Legacy LSP Deprecation

## TL;DR
> **Summary**: Establish the AFT (`aft_*`) toolchain as the primary, canonical toolset across all Oh-My-OpenCode (OmO) native agents and subagents (Sisyphus, Atlas, Hephaestus, Sisyphus-Junior, Prometheus, Explore, etc.), while completely deprecating and removing legacy `lsp-tools-mcp` / `lsp-daemon` interactive tools in favor of AFT's superior Rust-native LSP and code intelligence engines.
> **Deliverables**: Updated agent system prompts (`packages/prompts-core`), updated plugin built-in MCP registration & permissions (`packages/omo-opencode`), deprecation of `lsp` MCP from built-in MCPs, updated evidence/diagnostic verification gates, committed reference documentation (`docs/reference/aft-primary-toolset.md`), and updated test suites.
> **Effort**: Large
> **Risk**: Medium — touches agent system prompts, tool permission matrices, built-in MCP registry, and evidence verification gates across the workspace.

---

## 1. Context & Architectural Decisions

### Background & Motivation
- AFT (Accelerated Tooling Engine) provides indexed, AST-aware, token-efficient Rust engines (`aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`, `aft_inspect`, `aft_refactor`, `aft_import`, `aft_move`, `aft_safety`) that replace serial shell commands (`grep`, `rg`, `find`, `cat`, `sed`) and raw file readers.
- Real-world session analysis over recent weeks confirmed that legacy `lsp-tools-mcp` / `lsp-daemon` tools (`lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_diagnostics`, `lsp_prepare_rename`, `lsp_rename`) are dead weight in modern workflows and create dual-process LSP server duplication (running both AFT `LspManager` and `lsp-tools-mcp` child processes for the same language, doubling CPU/RAM).
- Cross-project technical alignment with the `aft` project (`6838de73`, `4e67f294`, `816750b2`) verified that `aft_inspect` provides an on-demand, scoped active diagnostic pull matching the LSP diagnostic standard, and tool hoisting cleanly preserves OpenCode plugin hook interception.

### Locked Architectural Decisions
- **D1 (LSP Engine & Process Model — Decision C)**: **AFT ONLY**. Completely retire `lsp-tools-mcp` and `lsp-daemon` from the active plugin runtime. AFT's native `LspManager` serves as the sole LSP engine. Non-builtin language servers are configured via global AFT configuration (`~/.config/cortexkit/aft.jsonc`).
- **D2 (Navigation & Intelligence)**: **AFT ONLY**. All code discovery, symbol outline, definition inspection, and call-graph / blast-radius analysis route through `aft_search`, `aft_outline`, `aft_zoom(callgraph=true)`, and `aft_callgraph`.
- **D3 (Evidence & Verification Gates)**: Update repository `AGENTS.md` and agent definitions to use `aft_inspect({ scope })` and status bar headers (`[AFT E<errors> W<warnings>]`) as the authoritative compilation/typecheck diagnostic gate.
- **D4 (Remote & Bridge Exceptions)**: Retain SuperMCP bridge tools (`compile_status`, `script_validate`) for remote VM and Unity workflows where local language servers lack remote assemblies.

---

## Todos
- [x] 1. Update Atlas prompts (`packages/prompts-core/prompts/atlas/*.md`) to use `aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`, and `aft_inspect`.
- [x] 2. Update Ultrawork prompts (`packages/prompts-core/prompts/ultrawork/*.md`) to replace raw shell/grep instructions with AFT sequences.
- [x] 3. Update base agent prompts and rules (`packages/omo-opencode/src/agents/`, `packages/prompts-core/prompts/`) to enforce AFT tools.
- [x] 4. Remove `lsp` entry from `createBuiltinMcps()` in `packages/omo-opencode/src/mcp/index.ts`.
- [x] 5. Update `packages/omo-opencode/src/mcp/types.ts` (`McpNameSchema`) to remove or deprecate `"lsp"`.
- [x] 6. Move `packages/omo-opencode/src/mcp/lsp.ts` and `lsp.test.ts` to deprecated state or cleanly unhook from plugin initialization.
- [x] 7. Update tool catalog documentation in `packages/omo-opencode/src/AGENTS.md` and `docs/reference/features.md`.
- [x] 8. Update `packages/omo-opencode/src/plugin-handlers/tool-config-handler.ts` Prometheus/Atlas/Sisyphus permissions.
- [x] 9. Update category tier maps and tool definitions in `packages/omo-opencode/src/tools/`.
- [x] 10. Update root `AGENTS.md` and package `AGENTS.md` files.
- [x] 11. Create docs/reference/aft-primary-toolset.md.
- [x] 12. Update unit tests in `packages/omo-opencode/` asserting built-in MCPs and permission handlers.
- [x] 13. Run `bun run typecheck` across all 37 workspace packages.
- [x] 14. Run `bun test` across the full test suite.
- [x] 15. Execute isolated OpenCode runtime QA via `script/agent/qa-sandbox.sh` and record all QA evidence.

## Final Verification Wave
- [x] F1. Plan compliance audit - tool: `oracle` (read-only).
- [x] F2. Code quality review - tool: `oracle` (read-only).
- [x] F3. Real manual QA - tool: `opencode-qa` skill.
- [x] F4. Scope fidelity - tool: `momus` (read-only).

## 3. Detailed Executable QA Scenarios

### Scenario 1: Built-in MCP Registration & Legacy LSP Omission
- **Tool/Command**: `bun test packages/omo-opencode/src/mcp/zauc-mocks-mcp-index/index.test.ts`
- **Action**: Verify that `createBuiltinMcps()` returns only active built-in MCPs (`websearch`, `context7`, `grep_app`, `codegraph`) and does not spawn `packages/lsp-daemon` or `packages/lsp-tools-mcp`.
- **Expected Result**: Exit code 0, assertions pass proving `lsp` MCP is omitted from built-in MCP configuration and no orphaned daemon processes are spawned.

### Scenario 2: Agent Permission Gating Matrix Validation
- **Tool/Command**: `bun test packages/omo-opencode/src/plugin-handlers/tool-config-handler-prometheus-permissions.test.ts`
- **Action**: Test permission evaluation for Prometheus (planner persona) and Sisyphus (executor persona) against `aft_*` tools.
- **Expected Result**: Prometheus permits `aft_search`, `aft_outline`, `aft_zoom`, `aft_callgraph`, `aft_inspect` and denies `aft_refactor`, `aft_delete`, `aft_move`, `aft_import`, `aft_safety`, `edit`, `write`. Sisyphus permits all `aft_*` tools.

### Scenario 3: Agent System Prompt & Rules Audit
- **Tool/Command**: `grep -rn "lsp_diagnostics" packages/prompts-core/ packages/omo-opencode/src/agents/`
- **Action**: Inspect all agent prompt files for stale `lsp_*` tool references.
- **Expected Result**: 0 occurrences of deprecated `lsp_diagnostics` / `lsp_goto_definition` tool names in prompt definitions; all prompts refer to `aft_search`, `aft_zoom`, `aft_outline`, `aft_callgraph`, `aft_inspect`.

### Scenario 4: Isolated OpenCode Runtime QA & Sandbox Verification
- **Tool/Command**: `source script/agent/qa-sandbox.sh && bunx opencode run "hello world" --format json`
- **Action**: Launch OpenCode inside an isolated XDG temporary sandbox (`XDG_CONFIG_HOME`, `XDG_DATA_HOME` in `/tmp`), load the plugin, and verify that the plugin initializes without errors, active tool catalog contains `aft_*` tools, and `~/.local/share/opencode/opencode.db` on the host remains untouched.
- **Expected Result**: Clean execution exit code 0, no runtime startup errors in `$TMPDIR/oh-my-opencode.log`, host SQLite session count unchanged before/after, and captured logs written to `.omo/evidence/<timestamp>-aft-primary-toolchain/runtime-smoke.log`.

### Scenario 5: Workspace Typecheck & Full Test Suite Gate
- **Tool/Command**: `bun run typecheck && bun test`
- **Action**: Run full workspace typecheck across all 37 packages followed by the root Bun test suite.
- **Expected Result**: `tsgo` exits 0 across all packages, Bun test exits 0 with 0 failed tests.

---

## 4. Definition of Done & Verification Criteria
1. **Tooling & Registration**:
   - Built-in MCPs no longer spawn or register legacy `lsp-tools-mcp` / `lsp-daemon`.
   - `aft_*` tools are fully recognized and correctly permission-gated across all native agents.
2. **Prompts & Personas**:
   - All agent prompts in `packages/prompts-core` reference `aft_*` as the canonical toolchain and omit deprecated `lsp_*` tools.
3. **Evidence & Quality Gates**:
   - `AGENTS.md` evidence rules specify `aft_inspect` and status bar headers for post-edit verification.
   - Clean `bun run typecheck` across all 37 packages.
   - All Bun tests pass with 0 failures.
   - Complete runtime smoke QA evidence recorded under `.omo/evidence/<timestamp>-aft-primary-toolchain/`.
4. **Documentation**:
   - `docs/reference/aft-primary-toolset.md` committed and documented.
5. **Git Hygiene**:
   - Clean commit on `feat/aft-primary-toolset` with verified QA evidence.
