> **DOCUMENTATION METADATA**
> - **Origin**: Fork-Local (`rustybret/agent-harness`)
> - **Support Status**: Supported (Fork-Specific)
> - **Notes**: Reference documentation for the Agentic Framework Toolchain (AFT) primary toolset.

# Agentic Framework Toolchain (AFT) Primary Toolset

AFT is the primary code intelligence and navigation engine for oh-my-opencode agents. It replaces the legacy LSP-based toolset (`lsp_*`) with a unified, high-performance suite of tools designed specifically for agentic workflows.

## 1. AFT Toolset Reference

| Tool | Purpose | Typical Invocation Shape | When to Reach for It |
| --- | --- | --- | --- |
| **aft_search** | Search code using concepts, identifiers, regex, literals, or filenames. NL-aware. | `aft_search({ query: "handleAuth" })` | Finding where a concept, error string, or symbol is defined or used. |
| **aft_outline** | Retrieve structural outline of source code, markdown, or HTML. | `aft_outline({ target: "src/auth/handler.ts" })` | Mapping the high-level structure of a file or directory before reading. |
| **aft_zoom** | Inspect the full source of a symbol or markdown section. | `aft_zoom({ path: "src/auth/handler.ts", symbols: "handleAuth" })` | Reading the exact implementation of a function, class, or type. |
| **aft_callgraph** | Analyze code relationships (callers, impact, trace paths, data flow). | `aft_callgraph({ op: "callers", path: "src/auth/handler.ts", symbol: "handleAuth" })` | Finding callers, tracing execution paths, or assessing refactoring impact. |
| **aft_inspect** | Get a codebase health snapshot (diagnostics, TODOs, dead code, duplicates). | `aft_inspect({ scope: "src/auth/" })` | Checking for compile/type errors, dead code, or TODOs after edits. |
| **aft_refactor** | Workspace-wide refactoring (move symbol, extract function, inline function). | `aft_refactor({ op: "move", path: "src/auth/handler.ts", symbol: "handleAuth", destination: "src/auth/utils.ts" })` | Moving symbols or extracting code while updating imports workspace-wide. |
| **aft_import** | Manage imports (add, remove, organize). | `aft_import({ op: "organize", path: "src/auth/handler.ts" })` | Sorting, grouping, or cleaning up imports in a file. |
| **aft_move** | Move or rename a file at the OS level. | `aft_move({ path: "src/auth/handler.ts", destination: "src/auth/auth-handler.ts" })` | Renaming or moving files (creates undo backups automatically). |
| **aft_safety** | File safety and recovery (checkpoint, undo, restore, list, history). | `aft_safety({ op: "checkpoint", name: "before-refactor" })` | Creating snapshots before risky edits or rolling back changes. |
| **aft_delete** | Delete files or directories with automatic backups. | `aft_delete({ files: ["src/auth/old-handler.ts"] })` | Safely deleting files or directories. |
| **aft_conflicts** | Show git merge conflicts across the repository. | `aft_conflicts({})` | Inspecting and resolving merge conflict regions. |
| **ast_grep_search** | Search code patterns using AST-aware matching. | `ast_grep_search({ pattern: "console.log($MSG)", lang: "typescript" })` | Finding structural code patterns across the workspace. |
| **ast_grep_replace** | Replace code patterns using AST-aware rewriting. | `ast_grep_replace({ pattern: "console.log($MSG)", rewrite: "logger.info($MSG)", lang: "typescript" })` | Applying structural rewrites across the workspace. |

## 2. Canonical Execution Sequence

When working on a task, follow this sequence to maximize efficiency and safety:

1. **Discovery (`aft_search`)**: Locate relevant files, symbols, or concepts.
2. **Structure (`aft_outline`)**: Map the structure of target files to identify key symbols.
3. **Zoom (`aft_zoom`)**: Read the exact implementation of target symbols.
4. **CallGraph (`aft_callgraph`)**: Trace callers and assess the blast radius of proposed changes.
5. **Safety (`aft_safety checkpoint`)**: Create a named checkpoint before making multi-file edits.
6. **Refactor / Edit (`aft_refactor` / `edit`)**: Apply changes to the codebase.
7. **Inspect (`aft_inspect`)**: Run the final verification gate to ensure no compile or type errors were introduced.

## 3. Configuring Custom LSP Servers

AFT uses a global, user-level configuration file to resolve language servers that are not bundled by default:

```
~/.config/cortexkit/aft.jsonc
```

This file allows users to define custom LSP commands, arguments, and file extensions.

> NOTE: The exact schema fields for `aft.jsonc` should be verified against AFT's own documentation before relying on specific field names, since this repository does not vendor or control that schema.

## 4. Remote VM / Unity SuperMCP Bridge Exceptions

SuperMCP bridge tools (such as `compile_status` and `script_validate`) remain the correct choice for remote VM and Unity workflows. Local AFT language servers cannot see remote assemblies or Unity editor states. This is an intentional architectural boundary, not a gap in AFT coverage.
