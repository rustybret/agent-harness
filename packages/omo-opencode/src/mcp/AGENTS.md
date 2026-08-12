# src/mcp/ — Built-in MCPs

**Generated:** 2026-08-11

## OVERVIEW

Tier 1 of the three-tier MCP system. Built-ins are created by `createBuiltinMcps(disabledMcps, config, options)` and include remote MCPs plus the local `codegraph` stdio MCP. Note: The legacy `lsp` built-in MCP has been retired from OpenCode runtime (AFT is now the primary code intelligence and navigation engine); `packages/lsp-tools-mcp/` and `packages/lsp-daemon/` are retained for Codex Light compatibility.

## BUILT-IN MCPs

| Name | Type | Endpoint / Command | Env Vars | Tools |
|------|------|--------------------|----------|-------|
| **websearch** | remote | `mcp.exa.ai` (default) or `mcp.tavily.com` | `EXA_API_KEY` (optional), `TAVILY_API_KEY` (if tavily) | Web search |
| **context7** | remote | `mcp.context7.com/mcp` | `CONTEXT7_API_KEY` (optional) | Library documentation |
| **grep_app** | remote | `mcp.grep.app` | None | GitHub code search |
| **codegraph** | local (stdio) | resolved `codegraph serve --mcp` (bundled npm / provisioned `~/.omo/codegraph` / PATH) | `CODEGRAPH_*` (download + telemetry off) | `codegraph_explore`, `codegraph_search`, `codegraph_node`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, `codegraph_status` |

## VENDORED LSP ARCHITECTURE (Codex Light Compatibility)

- The legacy `lsp` MCP is vendored at `packages/lsp-tools-mcp/` and `packages/lsp-daemon/`.
- OpenCode native agents use the Agentic Framework Toolchain (AFT) as the primary LSP and navigation engine; `lsp` registration in `createBuiltinMcps()` was retired in v4.18.0+.
- `packages/lsp-tools-mcp/` is retained strictly for Codex Light (`omo-codex`) compatibility.

## THREE-TIER SYSTEM

| Tier | Source | Mechanism |
|------|--------|-----------|
| 1. Built-in | `src/mcp/` | 3 remote HTTP MCPs + 1 local stdio MCP (`codegraph`) via `createBuiltinMcps()` |
| 2. Claude Code | `.mcp.json` | `${VAR}` expansion via `claude-code-mcp-loader` |
| 3. Skill-embedded | SKILL.md YAML | Managed by `SkillMcpManager` (stdio + HTTP) |

## FILES

| File | Purpose |
|------|---------|
| `index.ts` | `createBuiltinMcps()` registry for built-in MCPs |
| `types.ts` | `McpNameSchema`: `"websearch" \| "context7" \| "grep_app" \| "codegraph"` |
| `websearch.ts` | Exa/Tavily provider with config |
| `context7.ts` | Context7 with optional auth header |
| `grep-app.ts` | Grep.app (no auth) |
| `codegraph.ts` | Local stdio MCP config; resolves/gates the `codegraph` binary (gated by `config.codegraph.enabled`) |
