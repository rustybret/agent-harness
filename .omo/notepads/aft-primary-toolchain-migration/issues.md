# Issues — aft-primary-toolchain-migration

Problems and gotchas encountered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## 2026-08-10 Follow-up: dead Prometheus permission keys pending MCP-cleanup lane

- `tool-config-handler.ts` still has `lsp_rename: "deny"` and `lsp_install_decision: "deny"` in Prometheus's permission block.
- As of this task, the MCP-cleanup sibling lane has NOT retired those tool NAMES — they remain referenced in `plugin/tool-registry-trimming.ts`, `config/schema/dynamic-context-pruning.ts`, `agents/metis.ts`, and `features/builtin-commands/templates/refactor-sections/*`.
- ACTION (deferred): Once the MCP-cleanup lane confirms `lsp_rename`/`lsp_install_decision` are fully removed as registered tools, remove these two dead deny keys from Prometheus's block in `tool-config-handler.ts` AND the matching `HIDDEN_EXTRA` entries in `tool-config-handler-prometheus-permissions.test.ts`. Harmless no-ops until then.

## 2026-08-10 WS2 — Surprising extra callers of the lsp MCP (beyond index.ts + lsp.test.ts)

The plan anticipated one extra caller; there was a whole **omo doctor reporting chain** wired to the retired `lsp-tools-mcp` bundled server. All handled within this task's mission (retire the lsp MCP):

1. `cli/doctor/checks/tools-lsp.ts` (+ `tools-lsp.test.ts`) — `getInstalledLspServers()` imported `createLspMcpConfig` and reported `{ id: "lsp-tools-mcp" }` as an installed LSP server. DELETED both (the report is now flatly wrong).
2. `cli/doctor/checks/tools.ts` — called `getInstalledLspServers()`, populated `summary.lspServers`, emitted a "No LSP servers detected" issue, and a `LSP: ...` detail line. All removed.
3. `cli/doctor/checks/tools-mcp.ts` — `BUILTIN_MCP_SERVERS` listed `"lsp"`. Removed (no longer a built-in MCP).
4. Type/schema/format chain carrying `lspServers`: `cli/doctor/framework/types.ts` (`ToolsSummary.lspServers`), `help/schema/doctor.ts` (`LspServerInfoSchema` + field + type export), `framework/format-verbose.ts` + `format-status.ts` (LSP display blocks), `runner.ts` (timeout-result fixture). All removed.
5. Doctor test fixtures updated: `runner.test.ts`, `formatter.test.ts` (also flipped the `expect(output).toContain("LSP")` status-line assertion to `"AST-Grep"`), `format-default.test.ts`, `checks/tools.test.ts`.

### Left untouched deliberately (docs — sibling-lane / MUST-NOT-touch scope)
Stale `lsp`/`lspServers` mentions remain in `packages/omo-opencode/src/mcp/AGENTS.md`, `cli/doctor/AGENTS.md`, `plugin/AGENTS.md`, and `features/claude-code-plugin-loader/AGENTS.md`. Not edited — docs are out of this task's scope. Flagging for a docs-lane follow-up.
## 2026-08-10 Follow-up: opencode fork built-in slash commands need AFT migration

- Our omo plugin's native commands (incl. /refactor) are migrated. But the OPENCODE fork (rustybret/opencode) ships its OWN built-in slash commands that may still instruct agents to call legacy `lsp_*` tools.
- Sent coordination note to opencode project (messageId `c0746c54-edd0-469d-b4fe-2a64ec46234d`, intent plan) requesting they migrate their built-in slash commands to the AFT toolchain and asking which command/template locations carry `lsp_*` references.
- This is advisory / not blocking our migration. Track response in mailbox.