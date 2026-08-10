> **DOCUMENTATION METADATA**
> - **Origin**: Fork-Local (`rustybret/agent-harness`)
> - **Support Status**: Supported (Fork-Specific)
> - **Notes**: Classification inventory of packages and skills for AFT integration.

# Agent-Harness Packages & Skills Classification Overview

> **Scope:** Comprehensive inventory, categorization, and technical evaluation of `packages/` contents and associated skills within `agent-harness` (rustybret/agent-harness), specifically detailing overlap and integration with the **AFT (Agent Fine Tooling)** plugin.

---

## Executive Summary

The `agent-harness` monorepo provides a modular agent operating system comprising **42 sibling packages** and **over 30 operational skills**. As the repository moves toward a streamlined, high-throughput environment, several legacy tools (stdio MCP wrappers, external CLI binaries, line-hash editors, standalone URL fetchers) overlap with native **AFT plugin capabilities** (`aft_search`, `aft_zoom`, `aft_outline`, `aft_callgraph`, `aft_inspect`, `aft_refactor`, `aft_import`, `aft_move`, `aft_delete`, `aft_safety`, `ast_grep_search`, `ast_grep_replace`, `lsp_*`).

### Core Architectural Decisions:
1. **KEEP OmO's Multi-Agent Orchestration Engine:** Retain core strengths in multi-agent routing (`omo-opencode`, `delegate-core`), team mode (`team-core`), work tracking (`boulder-state`), rule injection (`rules-engine`), and task execution (`todowrite`, `prompt-async-gate`).
2. **REJECT Redundant Stdio MCPs & External Wrappers:** Deprecate `lsp-tools-mcp` and `lsp-daemon` in environments where AFT provides native language-server diagnostics and static analysis; reject `ast-grep-mcp` where native `ast_grep_search`/`ast_grep_replace` exist; reject `pi-webfetch` and `pi-goal` in favor of built-in fetchers, `context7`, and Magic Context.
3. **MODIFY Best Practices & Refactoring Skills:** Update engineering skills (`programming`, `debugging`, `refactor`, `tech-debt-audit`, `remove-ai-slops`) to strictly mandate `aft_search` over serial bash grep, `aft_callgraph` for impact analysis, `aft_refactor`/`ast_grep_replace` for structural edits, and `aft_safety` for checkpoint recovery.

---

## Category 1: Harness Tools & Core Modules

This category includes the 42 packages in `packages/` that form the runtime infrastructure, adapter shims, MCP servers, and core utilities.

### 1.1 Package Classification & Disposition

| Package | Role | Purpose / Description | Disposition | Rationale & AFT Integration |
|---------|------|-----------------------|-------------|-----------------------------|
| `omo-opencode` | Adapter | OpenCode Ultimate edition build entry (`src/index.ts` → `dist/`). Holds 11 agents, 55+ hooks, features, built-in MCPs. | **KEEP & MODIFY** | Primary OpenCode adapter. Modify tool registration to delegate LSP, search, and structural edits to AFT native tools while keeping multi-agent orchestration hooks. |
| `omo-codex` | Adapter | Codex CLI Light edition adapter (`lazycodex-ai` on npm, plugin `omo@sisyphuslabs`). | **KEEP** | Essential adapter for isolated Codex Light execution and app-server integration. |
| `omo-senpi` | Adapter | Native Senpi TypeScript extension adapter (`packages/omo-senpi/plugin`). | **OPTIONAL** | Local-path Pi adapter. Retain if Pi environment support is required; otherwise isolate. |
| `senpi-task` | Adapter Support | Senpi-coupled task engine (record store, residency, steering, named teams). | **OPTIONAL** | Tied to `omo-senpi`. Superseded by native OpenCode `task` + `todowrite` + `team-core`. |
| `pi-goal` | Adapter | Standalone Pi goal tools (`create_goal`, `/goal`, TUI status). | **REJECT** | Redundant. Goal tracking is handled by `todowrite`, `boulder-state`, and `ctx_note`. |
| `pi-webfetch` | Adapter | Standalone URL-to-markdown/text/HTML converter. | **REJECT** | Redundant. AFT built-in `webfetch`, `context7`, and `websearch_tavily_*` handle URL retrieval and library documentation with reranking. |
| `lsp-tools-mcp` | MCP | Stdio MCP serving `lsp_*` tool aliases (`lsp_diagnostics`, `lsp_goto_definition`, etc.). | **REJECT / DEPRECATE** | Redundant when AFT is active. AFT natively serves `lsp_*` tools directly without stdio MCP process overhead. |
| `lsp-daemon` | MCP | Unix-socket / named-pipe daemon + stdio proxy for shared warm LSP processes. | **REJECT / DEPRECATE** | Redundant when host AFT provides native language server lifecycle management. |
| `ast-grep-mcp` | MCP | Stdio MCP wrapping external `sg` binary. | **REJECT / DEPRECATE** | Superseded by AFT native `ast_grep_search` and `ast_grep_replace` tree-sitter tools which require no external `sg` binary. |
| `git-bash-mcp` | MCP | Windows-specific git-bash wrapper for Codex edition. | **KEEP** | Retain for Windows environment compatibility in Codex Light edition. |
| `boulder-state` | Core | Work tracking state machine across context compaction (`.omo/boulder.json`). | **KEEP** | Essential state persistence engine for multi-step tasks across compaction. |
| `team-core` | Core | Team-mode registry, mailbox, tasklist, state, and worktree isolation primitives. | **KEEP** | Core multi-agent team orchestration engine. |
| `delegate-core` | Core | Task routing, category selection, and subagent retry primitives. | **KEEP** | Core subagent delegation and continuation logic. |
| `hashline-core` | Core | `LINE#ID` tagged edit primitives and diff validation helpers. | **MODIFY** | Retain as fallback line-editing safety, but prefer AFT `edit` (symbol/range replace), `aft_refactor`, and `ast_grep_replace` which do not depend on stale line hashes. |
| `comment-checker-core` | Core | AST/parser engine checking AI slop comments on code edits. | **KEEP** | Essential code hygiene filter enforcing `// @allow` and file-level comment discipline. |
| `rules-engine` | Core | Rule discovery & matching engine for `.omo/rules/*.md`. | **KEEP** | Required for automated project constraint injection. |
| `agents-md-core` | Core | Hierarchical `AGENTS.md` walk-up discovery and prompt injection. | **KEEP** | Fundamental context discovery layer. |
| `model-core` | Core | Model capability resolution pipeline and ProviderCache. | **KEEP** | Core provider and model routing logic. |
| `prompts-core` | Core | Harness-neutral markdown prompt loader & mode prompt definitions. | **KEEP** | Centralized prompt storage and routing. |
| `utils` | Core | Shared deep-merge, snake-case, frontmatter, and file utility functions. | **KEEP** | Core utility library used across all packages. |
| `telemetry-core` | Core | Harness-neutral telemetry primitives & PostHog wrappers. | **KEEP** | Telemetry abatement and daily active metric wrappers. |
| `lsp-core` | Core | Harness-neutral LSP data types, request context, and tool definitions. | **KEEP** | Shared LSP data contracts. |
| `mcp-stdio-core` | Core | Shared JSON-RPC stdio framing and dispatch primitives for MCP servers. | **KEEP** | Core transport primitives. |
| `tmux-core` | Core | Harness-neutral tmux session, pane, layout, and runner primitives. | **KEEP** | Essential for interactive TUI smoke tests and background process visualization. |
| `claude-code-compat-core` | Core | Claude Code compatibility loaders (plugins, MCPs, commands, agents). | **KEEP** | Interoperability wrapper for `.mcp.json` and Claude Code skills. |
| `skills-loader-core` | Core | Skill loading, runtime skill resolution, and YAML frontmatter parser. | **KEEP** | Engine for discovering and executing `SKILL.md` bundles. |
| `mcp-client-core` | Core | Per-session MCP client manager and OAuth PKCE/DCR handlers. | **KEEP** | Tier-3 skill-embedded MCP lifecycle manager. |
| `openclaw-core` | Core | OpenClaw gateway, reply listener daemon, and tmux injection shims. | **KEEP** | External notification and messaging bridge (Discord/Telegram/HTTP). |
| `omo-config-core` | Core | Harness-neutral `omo.json` schema, walked loader, and atomic writer. | **KEEP** | Unified multi-level configuration parser. |
| `oh-my-opencode-*` (12 pkgs) | Platform | Compiled Node launcher packages (OS × arch × libc variants). | **KEEP** | Platform distribution shims generated by `script/build-binaries.ts`. |

---

## Category 2: Agent Best Practices Skills & Guidance

This category includes engineering standards, domain expertise, workflow guides, and refactoring patterns stored under `packages/shared-skills/skills/`, `.agents/skills/`, and `.opencode/skills/`.

### 2.1 Skill Evaluation & AFT Tool Integration

| Skill Name | Purpose / Scope | Disposition | AFT Integration & Modification Strategy |
|------------|-----------------|-------------|----------------------------------------|
| `programming` | Strict typing, TDD, architectural ceiling (250 LOC), modern toolchains. | **MODIFY** | **Mandate AFT Tools:** Replace instructions favoring raw `grep`/`rg` or manual line edits with `aft_search` (concept/regex search), `ast_grep_search`/`ast_grep_replace` (AST rewrites), `aft_refactor` (symbol move/extract), and `aft_inspect` (LSP diagnostic checks). |
| `debugging` | Hypothesis-driven debugging loop across languages and runtimes. | **MODIFY** | **Incorporate Call Graph & Diagnostics:** Integrate `aft_callgraph` (`callers`, `impact`, `trace_to`, `trace_data`) to trace runtime call chains and state propagation. Use `lsp_diagnostics` and `aft_inspect` for root-cause verification instead of shotgun edits. |
| `refactor` | Codebase restructuring, modularization, and simplification. | **MODIFY** | **Direct AFT Refactoring:** Replace multi-step grep+read+edit chains with `aft_refactor` (`op: "move"`, `"extract"`, `"inline"`), `aft_import` (AST-aware import management), and `ast_grep_replace`. Use `aft_safety` checkpoints before bulk operations. |
| `remove-ai-slops` | Detection and cleanup of AI-generated code smells (over-objectification, redundant types). | **MODIFY** | **Automated AST Rewriting:** Drive cleanup using `ast_grep_replace` and `comment-checker-core` rather than manual regex replaces. |
| `review-work` | Post-implementation 5-agent verification orchestrator (Oracle, QA, Security, Mining). | **KEEP** | Retain full multi-subagent verification gate prior to landing PRs or completing major features. |
| `visual-qa` | Visual QA across web and terminal UIs using browser automation and TUI snapshots. | **KEEP** | Essential UI validation pipeline. |
| `security-research` / `security-review` | Team Mode audit orchestrating 3 vulnerability hunters and 2 PoC engineers. | **KEEP** | Crucial security research workflow for discovering exploitability and root causes. |
| `git-master` | Atomic commits, branch isolation, rebase/squash discipline, history search. | **KEEP** | Retain git management rules. Ensure commands honor repo `--no-verify` pre-commit hook policies where applicable. |
| `data-scientist` | DuckDB / Polars dataset processing and SQL analytics via `uv`. | **KEEP** | Domain-specific analytics skill. |
| `lsp-setup` | Language server configuration for editor and agent tooling across 20+ languages. | **MODIFY** | Align configuration scripts (`detect-lsp.ts`, `verify-lsp.ts`) with native AFT LSP bindings. |
| `exa-research` | High-quality web research via Exa API for technical papers and web content. | **KEEP** | Specialized search tool. |
| `perplexity-advanced-mcp` | Real-time web search and synthesis via Perplexity API. | **KEEP** | Advanced research tool when local codebase and context7 docs are insufficient. |
| `web-search-routing` | Router guiding selection between Tavily, Exa, and Perplexity. | **KEEP** | Search tool decision guide. |
| `ultimate-browsing` | Escalation browser skill for blocked or anti-bot web access (curl_cffi, Playwright stealth). | **KEEP** | Advanced scraping router. |
| `game-tdd-author` | Technical design document authoring for game system contracts. | **KEEP** | Domain-specific architecture skill. |
| `gdd-author` | Game design document intent and mechanics authoring. | **KEEP** | Domain-specific design skill. |
| `tech-debt-audit` | 9-dimension technical debt audit producing prioritized `TECH_DEBT_AUDIT.md`. | **MODIFY** | **Integrate AFT Code Intelligence:** Combine AST matching with `aft_inspect` (dead code, duplicate clones, metric tiering) and `aft_callgraph` for architectural blast radius assessment. |

---

## Category 3: Plugin Tool Utilization Skills (Agent-Harness / OmO Specific)

This category covers skills designed specifically to drive, orchestrate, or QA internal OmO/agent-harness features, subagent roles, and state engines.

### 3.1 Harness-Specific Skill Evaluation

| Skill Name | Purpose / Scope | Disposition | Operational Guidance & Modification Strategy |
|------------|-----------------|-------------|---------------------------------------------|
| `start-work` / `ulw-loop` | Execution of Prometheus work plans with boulder state, evidence ledgers, and worktrees. | **KEEP** | **Primary Harness Loop:** Drives plan execution, `.omo/boulder.json` state updates, and `.omo/evidence/` recording. Must use `aft_safety` checkpoints when starting major plan phases. |
| `ulw-plan` / `hyperplan` | Adversarial multi-agent planning & Metis/Momus plan formalization. | **KEEP** | **Rigorous Planning Engine:** Produces decision-complete `.omo/plans/*.md` files evaluated by Momus critics before execution. |
| `opencode-qa` | Self-QA for OpenCode plugin CLI, SSE event stream, tmux TUI, and SQLite DB. | **KEEP** | **Mandatory QA Gate:** Exercises isolated `XDG_*` sandboxes (`scripts/qa-sandbox.sh`) and records plain-text evidence under `.omo/evidence/`. |
| `codex-qa` | Self-QA for Codex Light edition (`lazycodex` / `packages/omo-codex`). | **KEEP** | **Mandatory Codex Gate:** Drives real `codex app-server` against isolated `CODEX_HOME` + mock model and asserts plugin hook notifications. |
| `work-with-pr` | Full PR lifecycle in task-owned git worktree with evidence-bound manual QA. | **KEEP** | Standard delivery pipeline for upstream code-yeongyu contributions. (Note: Fork maintenance changes use direct `fork/local` commits per repo rule #1789). |
| `omo-skill-authoring` | Rules for writing OmO native skills, SKILL.md frontmatter, and skill-embedded MCPs. | **KEEP** | Canonical guide for extending OmO skill definitions. |
| `customize-opencode` | Editing configuration (`oh-my-openagent.jsonc`), agents, subagents, skills, and permission rules. | **KEEP** | Scoped tool for editing agent-harness configuration files. |
| `team-mode` | Creation and parallel coordination of agent teams (`~/.omo/teams/`). | **KEEP** | Orchestrates parallel member subagents with isolated worktrees and mailbox messaging. |
| `get-unpublished-changes` | Compares HEAD against npm registry to list unpublished layer changes. | **KEEP** | Release auditing tool. |
| `publish` | Triggers GitHub Actions npm publish workflow and verifies release artifacts. | **KEEP** | Ship-only release launcher. |
| `pre-publish-review` | 16-agent release gate executing multi-perspective code, security, and quality audits. | **KEEP** | Pre-release security and stability gate. |
| `remove-deadcode` | Automated removal of unused exports and dead code with LSP safety. | **MODIFY** | **Power with AFT Inspection:** Drive dead-code discovery via `aft_inspect(sections: ["dead_code", "unused_exports"])` and verify reachability using `aft_callgraph`. |
| `github-triage` | Read-only analysis of open GitHub issues and PRs writing evidence reports. | **KEEP** | Autonomous repository triage tool. |
| `macos-cua` / `unity-modal-dismiss` | CoreGraphics/AX desktop automation and Unity Editor modal dismissal. | **KEEP** | Native desktop automation shims. |
| `unity-gamedev` / `unity-smoke-harness` | End-to-end Unity SuperMCP bridge workflows and PlayMode regression testing. | **KEEP** | Dedicated Unity engine integration harness. |

### LSP Replacement & Session Environment Discipline

1. **AFT Replacement of OmO Stdio LSP Packages:**
   - **OmO Legacy LSP Packages (`lsp-tools-mcp` & `lsp-daemon`):** **Completely Disabled & Replaced by AFT.** In prior sessions, analysis confirmed that AFT supersedes OmO's stdio LSP MCP proxy and unix-socket daemon. When AFT is present, it directly serves native `lsp_*` tools (`lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`) and internal diagnostic health checks (`aft_inspect`), eliminating OmO's child stdio LSP processes entirely.

2. **Session Execution Environment Discipline (Mandatory Rule):**
   - **OS & Architecture Alignment:** OpenCode agent sessions must ALWAYS run on the same OS and architecture as the target project environment if possible.
   - **Project Root Grounding:** The active agent session directory MUST be rooted directly in the target project root directory—never across mismatched OS, cross-platform SSH mounts, or foreign directory trees.

---

## Tool Overlap & Integration Matrix (OmO Harness vs. AFT Plugin)

The following matrix contrasts legacy/harness tools against AFT native tools and specifies the operational policy for agents in this repository.

| Domain | OmO / Legacy Harness Tool | AFT Plugin Tool | Operational Policy & Preferred Pattern |
|--------|---------------------------|-----------------|----------------------------------------|
| **Code Search** | `grep`, `glob`, shell `rg` | `aft_search` | **MUST USE `aft_search`:** Single call auto-routes concepts, identifiers, regex, and literals. Eliminates serial bash grep loops. |
| **Code Inspection** | Manual `read` / line ranges | `aft_outline`, `aft_zoom`, `codegraph_explore` | **PREFER AFT / CODEGRAPH:** Use `aft_outline` for file/dir symbol hierarchy, `aft_zoom` for symbol bodies with call-graph context, and `codegraph_explore` for cross-file graph traversal. |
| **Structural AST Query / Edit** | `ast-grep-mcp` (external `sg` CLI wrapper) | `ast_grep_search`, `ast_grep_replace` | **MUST USE `ast_grep_*`:** Native tree-sitter AST pattern matching and rewriting across 9 languages without external process dependencies. |
| **Call Graph & Impact Analysis** | Manual grep + read chains | `aft_callgraph` | **MUST USE `aft_callgraph`:** Query `callers`, `impact`, `trace_to`, `trace_data`, and `call_tree` to map blast radius before modifying function signatures. |
| **Language Diagnostics & Health** | `lsp-tools-mcp` / `lsp-daemon` | `lsp_*`, `aft_inspect` | **PREFER AFT NATIVE:** Use built-in `lsp_*` tools for language server operations. Use `aft_inspect` for workspace health snapshots (LSP diagnostics, dead code, unused exports, duplicates). |
| **File Editing & Refactoring** | `hashline_edit` (LINE#ID tagged edits) | `edit`, `aft_refactor`, `aft_import`, `aft_move`, `aft_delete` | **PREFER AFT REFACTORING:** Use `edit` for line/symbol replacements, `aft_refactor` for moving/extracting functions, `aft_import` for AST-aware import management, and `aft_move`/`aft_delete` for file management. |
| **Safety & Recovery** | Manual git stash / undo | `aft_safety` | **MUST USE `aft_safety`:** Create named checkpoints (`aft_safety(op: "checkpoint")`) before complex multi-file edits and use `undo`/`restore` for instant rollback. |
| **Web Fetching & Docs** | `pi-webfetch` (standalone converter) | `webfetch`, `context7`, `websearch_tavily_*` | **PREFER CONTEXT7 / WEBFETCH:** Use `context7` for up-to-date library/framework documentation, and `webfetch`/`websearch_tavily_*` for general URL retrieval and reranking. |
| **State & Memory** | `pi-goal` (standalone goal tool) | `todowrite`, `boulder-state`, `ctx_memory` | **PREFER TODOWRITE + BOULDER:** Use `todowrite` for turn-by-turn task tracking, `boulder-state` for context compaction survival, and `ctx_memory` for durable cross-session facts. |

---

## Cross-Project Review & AFT Counterpart Tool Taxonomy

### Cross-Project Dispatch Record
- **Target Project:** `aft` (`aft-5fc3f7ed`)
- **Message ID:** `86089fbc-d264-441f-998c-7277c0162690`
- **Correlation ID:** `5df7cfa6-3f18-423a-8291-ed0befefdbdc`
- **Intent:** `plan`
- **Status:** Queued (target presence: `offline`)

---

### AFT Native Tool Taxonomy & Equivalent Categories

AFT provides a native, AST-aware, and index-backed tool suite. Below is the equivalent taxonomy matching OmO/agent-harness functional roles:

#### AFT Category A: Search, Navigation & Symbol Inspection
- **`aft_search`**: Multi-modal search (concepts, identifiers, regex, literals, filenames) auto-routed in a single call. Replaces serial `grep`/`rg`/`find` bash pipelines.
- **`aft_outline`**: Structural symbol outline for files/directories or Markdown/HTML heading hierarchy.
- **`aft_zoom`**: Full source retrieval for symbols with optional single-file call-graph annotations.
- **`codegraph_explore` / `codegraph_node`**: Knowledge-graph symbol lookup with verbatim source and caller/callee paths.

#### AFT Category B: Static Analysis, Call Graph & Diagnostics
- **`aft_callgraph`**: Multi-level reverse caller resolution (`callers`), blast-radius analysis (`impact`), execution flow tracing (`trace_to`), target route shortest-path (`trace_to_symbol`), and data flow tracking (`trace_data`). Replaces manual grep/read trace chains.
- **`aft_inspect`**: Workspace health snapshot returning synchronous Tier-1 (diagnostics, TODOs, file metrics) and background Tier-2 (dead code, unused exports, code duplication, TS/JS import cycles). Replaces ad-hoc linter/dead-code scripts.
- **`lsp_*`**: Native host Language Server Protocol bindings (`lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`).

#### AFT Category C: Structural AST Matching & Rewriting
- **`ast_grep_search`**: Pattern search over AST syntax nodes across 9 languages using meta-variables (`$VAR`, `$$$`).
- **`ast_grep_replace`**: Structural code replacement preserving matched AST variables. Replaces regex sed/awk edits and external `sg` binary calls.

#### AFT Category D: Refactoring, Import Management & Safety
- **`aft_refactor`**: Workspace-wide symbol relocation (`move`), function body extraction (`extract`), and call-site body inlining (`inline`), with automatic workspace-wide import updating.
- **`aft_import`**: Language-aware import management (`add`, `remove`, `organize`) supporting TS, JS, Python, Rust, Go, Java, C#, PHP, Swift, and Solidity.
- **`aft_move` / `aft_delete`**: File system mutation with automatic safety backup creation.
- **`aft_safety`**: Per-file edit snapshots, checkpoint creation (`checkpoint`), checkpoint restoration (`restore`), and single-step or single-file undo (`undo`). Replaces manual git stashes.

#### AFT Category E: Session Memory, Tracking & Reduction
- **`ctx_memory`**: Durable cross-session knowledge store (`write`, `update`, `archive`, `merge`, `get`).
- **`ctx_note`**: Session reminders and smart notes with external condition surface checks.
- **`ctx_search`**: Full-text recall across memories, message history, git commits, and parked notes.
- **`ctx_expand` / `ctx_reduce`**: Selective message history recovery and spent tool output tag release.
- **`todowrite`**: Structured turn-by-turn task list tracking with mandatory WHERE/WHY/HOW/EXPECTED RESULT formatting.

---

### OmO Abilities Disabled or Superseded by AFT

The following OmO/agent-harness capabilities are explicitly superseded or disabled when operating within an AFT-enabled environment:

| OmO Tool / Subsystem | Status | Superseding AFT Tool / Mechanism | Technical Rationale |
|----------------------|--------|----------------------------------|---------------------|
| `lsp-tools-mcp` (Stdio MCP) | **Disabled / Superseded** | Native `lsp_*` tools in AFT | AFT serves LSP requests directly inside the agent host environment without child stdio process overhead or IPC latency. |
| `lsp-daemon` (Unix Socket Daemon) | **Disabled / Superseded** | Native AFT Language Server lifecycle | AFT manages language server instances natively; separate unix-socket daemons create process leaks and duplicate AST parses. |
| `ast-grep-mcp` (Stdio MCP) | **Disabled / Superseded** | `ast_grep_search` / `ast_grep_replace` | Native tree-sitter integration replaces spawning an external `sg` CLI binary via stdio MCP. |
| `pi-webfetch` (Pi Converter) | **Disabled / Superseded** | `webfetch` + `context7` | Built-in `webfetch` and `context7` handle URL fetching, HTML-to-markdown conversion, and library doc retrieval with reranking. |
| `pi-goal` (Pi Goal Tools) | **Disabled / Superseded** | `todowrite` + `boulder-state` + `ctx_note` | Turn-by-turn task tracking belongs in `todowrite`; compaction survival belongs in `boulder-state`; parked items belong in `ctx_note`. |
| Raw Bash `grep` / `rg` Chains | **Banned / Superseded** | `aft_search` | `aft_search` uses indexed concept and identifier search in a single call, avoiding unindexed serial file scanning. |
| Manual Line-Hash Edits (`hashline_edit`) | **Superseded** | `edit` / `aft_refactor` / `ast_grep_replace` | Symbol replacement, line-range editing, and AST-aware refactoring eliminate the need to calculate or verify `LINE#ID` hashes. |
| Manual Git Stash for Edit Backups | **Superseded** | `aft_safety(op: "checkpoint")` | `aft_safety` creates named per-file snapshots and allows single-turn `undo` or full checkpoint `restore` without altering git working tree state. |

### Complete Inventory of OmO LSP Tools & Domain Capabilities

To ensure full coverage, the table below documents all 8 LSP tools, language mappings, and specialized features developed in `agent-harness` (`packages/lsp-core`, `packages/lsp-tools-mcp`, `packages/shared-skills/skills/lsp-setup/`), detailing how each is mapped or overridden when integrated with AFT via OpenCode plugin hooks:

| Tool / Capability Name | Alias / Component | Description & Scope | Plugin Override / AFT Integration Strategy |
|------------------------|-------------------|---------------------|--------------------------------------------|
| **`status`** | `lsp_status` | Lists configured and active LSP servers without starting a new server instance. | **AFT Status Bar Integration:** Intercepted via `tool.execute.after` to populate AFT health headers (`[AFT E<errors> W<warnings>]`). |
| **`diagnostics`** | `lsp_diagnostics` | Retrieves line-by-line errors, warnings, information, and hints with severity filters (`error`, `warning`, `info`, `hint`, `all`). | **Domain Diagnostic Fallback:** `tool.execute.after` catches empty AFT results on domain files (Ansible, Helm, Unity C#) and falls back to OmO's `packages/lsp-core` directory diagnostics sweep. |
| **`goto_definition`** | `lsp_goto_definition` | Finds where a symbol is defined using 1-based line and 0-based column coordinates. | **Context Injector (`tool.execute.before`):** Rewrites request context for domain-specific files (e.g. injecting `.sln` path for Unity C# or Chart schemas for Helm). |
| **`find_references`** | `lsp_find_references` | Finds all symbol references across the workspace with optional `includeDeclaration` flag. | **AFT Callgraph Cross-Check:** Combined with `aft_callgraph(op: "callers")` to capture both AST references and dynamic callback registrations. |
| **`symbols`** | `lsp_symbols` | Document outline (`scope: "document"`) or workspace symbol search (`scope: "workspace"`) with `query` and `limit`. | **AFT Outline Enhancement:** Seamlessly maps to `aft_outline` for structural file outlines and `codegraph_search` for workspace symbol queries. |
| **`prepare_rename`** | `lsp_prepare_rename` | Validates whether a symbol at line/character position can be safely renamed. | **Pre-Rename Safety Gate:** Executed prior to `aft_refactor` to verify symbol rename eligibility before workspace-wide refactoring. |
| **`rename`** | `lsp_rename` | Executes workspace-wide symbol renaming and applies multi-file workspace edits. | **`aft_refactor` / `aft_safety` Pair:** Combines with `aft_safety` checkpointing to create a restore point before applying LSP workspace edits. |
| **`install_decision`** | `lsp_install_decision` | Tracks user authorization (`allowed` / `declined`) for missing LSP server installations (`InstallDecisionRecord`). | **Non-Blocking Install Gate:** Prevents agent execution hangs by recording user preferences when language server binaries are absent. |
| **Language Mapping Engine** | `EXT_TO_LANG` (130+ ext) | Maps 130+ file extensions (`.cs`, `.yaml`, `.rs`, `.py`, `.go`, `.ts`, etc.) to LSP language IDs. | **Plugin Glob Provisions (`config` hook):** Dynamically provisions non-standard extensions in OpenCode's active configuration read by AFT. |
| **Unity C# Context Resolver** | Project Marker Resolver | Detects `ProjectSettings/`, `Assets/`, and `.sln` files to resolve C# assembly references for `csharp-ls` / `omnisharp`. | **Pre-Flight Context Injector (`tool.execute.before`):** Supplies solution context to `lsp_*` calls targeting Unity C# files. |
| **Ansible / Helm YAML Router** | Domain YAML Schema Router | Differentiates generic YAML from `roles/`/`playbook.yml` (`ansible-language-server`) and `templates/*.yaml` (`yaml-language-server` with Kubernetes schemas). | **Pre-Flight Schema Injector (`tool.execute.before`):** Dynamically binds Ansible and Helm Kubernetes schemas to AFT YAML tool executions. |

---

## Action Plan & Implementation Recommendations

1. **Deprecate Redundant Stdio MCPs:**
   - Remove dependency on `lsp-tools-mcp`, `lsp-daemon`, and `ast-grep-mcp` in default OpenCode configurations where AFT is active.
   - Retain `git-bash-mcp` strictly for Windows Codex Light compatibility.

2. **Update Core Skill Rulesets (`packages/shared-skills/skills/`):**
   - Update `programming/SKILL.md`, `debugging/SKILL.md`, `refactor/SKILL.md`, `tech-debt-audit/SKILL.md`, and `remove-ai-slops/SKILL.md` to explicitly forbid serial bash `grep`/`rg` and mandate `aft_search`, `aft_callgraph`, `ast_grep_replace`, and `aft_safety`.

3. **Purge Obsolete Standalone Adapters:**
   - Unwire `pi-goal` and `pi-webfetch` from default workspace packaging. Replace all URL and goal workflows with native `context7`, `webfetch`, `todowrite`, and `boulder-state`.

4. **Retain & Protect Core Orchestration:**
   - Preserve `omo-opencode`, `omo-codex`, `boulder-state`, `team-core`, `delegate-core`, `rules-engine`, `comment-checker-core`, and `openclaw-core` as the primary multi-agent OS layer.
