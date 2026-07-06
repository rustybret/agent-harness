# Upstream Document & Metadata Inventory for Private Forks

This document inventories the metadata, configuration files, workflows, and guidance documentation originally sourced from the upstream repository. It classifies their relevance and actions required when adapting the codebase for a private, fork-based development model.

---

## 1. Repository Configuration & Git Attributes

| File Path | Description | Relevance for Private Adaptation |
| :--- | :--- | :--- |
| **`.gitattributes`** | Dictates merge behaviors, syntax highlighting, and end-of-line normalization. | **Critical (Fork-Specific)**: Configured with `merge=ours` to prevent upstream merges from overwriting fork-specific files (e.g., GitHub workflows, `AGENTS.md`, `.gitmodules`). |
| **`.gitignore`** | Declares paths and files excluded from version control. | **Critical (Fork-Specific)**: Keeps development artifacts, test sandboxes, and local credentials (`.env`, `.cortexkit/`, `.local-ignore/`) strictly isolated within the repository. |
| **`.gitmodules`** | Defines submodules linked to the repository. | **Obsolete**: Dropped during scope-limiting. The local build skips upstream submodules without failing. |

---

## 2. Primary Guidance & System Prompts

| File Path | Description | Relevance for Private Adaptation |
| :--- | :--- | :--- |
| **`AGENTS.md`** | Main instruction manual for AI agents. Defines system architecture, hooks, tools, and the workflow engine. | **Critical (Fork-Specific)**: Serves as the primary source of truth for the agent. The fork version overrides upstream with private workflow instructions (e.g., committing directly to `fork/local` instead of creating PRs, and the OpenCode-only focus). |
| **`CLAUDE.md`** | Symlink to `AGENTS.md` parsed by Claude Code. | **Critical (Fork-Specific)**: Syncs agent behavior across different harnesses. |
| **`ROADMAP.md`** | Outlines upstream’s package layering and multi-harness refactoring plans. | **Low Relevance**: Kept for context when evaluating how upstream changes affect the local layout during synchronization. |
| **`CONTRIBUTING.md`** | Outlines developer setup, PR criteria, and test requirements. | **Low Relevance**: Relates to contributing back to the upstream `dev` branch. Not relevant to internal modifications. |

---

## 3. GitHub Actions Workflows (`.github/workflows/`)

| File Path | Description | Relevance for Private Adaptation |
| :--- | :--- | :--- |
| **`sync-upstream.yml`** | Automatically merges upstream pristine branches into `fork/local`. | **Critical (Fork-Specific)**: Custom-tailored to run rebase-free merges (`git merge`) instead of destructive rebases, handling conflicts via a dedicated branch. |
| **`ci.yml`** | Standard CI pipeline checking builds, types, and running tests. | **Relevant**: Streamlined to run tests on `fork/local` pushes while omitting upstream Codex compatibility checks and published package smoke tests. |
| **`publish.yml`** | Workflow triggering NPM publishing and binary uploads. | **Low Relevance**: Gated to upstream's release channels. Private forks bypass NPM publishing, compiling binaries locally if needed. |
| **`publish-platform.yml`** | Helper for cross-compiling platform-specific binaries. | **Low Relevance**: Upstream release automation. |
| **`lint-workflows.yml`** | Runs actionlint against `.github/workflows/`. | **Relevant**: Keeps local workflow changes syntactically clean. |
| **`refresh-model-capabilities.yml`** | Weekly cron job to fetch fresh metadata from models.dev. | **Relevant**: Keeps LLM capabilities configurations in sync. |
| **`local-build.yml`** / **`stats.yml`** | Miscellaneous build/stat checking actions. | **Low Relevance**: Upstream maintenance metrics. |
| **`web-ci.yml`** / **`web-deploy.yml`** | Website CI and deployment scripts. | **Obsolete**: Deleted. The Next.js website package has been excised from this fork. |

---

## 4. Project-Level Agent Instructions (`.omo/` & `.agents/`)

| File Path | Description | Relevance for Private Adaptation |
| :--- | :--- | :--- |
| **`.omo/rules/test-discipline.md`** | Enforces unit test rules and forbids mock modules leakage. | **Relevant (Shared)**: Validates that code edits remain clean and robust. |
| **`.agents/AGENTS.md`** | Package-specific adapter definitions and agent instructions. | **Relevant (Shared)**: Standardizes how the workspace loaders register tools. |
| **`.agents/skills/**/*.md`** | Directory of skill prompt templates (e.g., `git-master`, `frontend`). | **Relevant (Shared)**: Scopes specialized tools to specific tasks. |
| **`.agents/command/*.md`** | Custom workspace slash commands. | **Relevant (Shared)**: Governs slash command parameters. |

---

## 5. Documentation Guides (`docs/`)

### User Guides (`docs/guide/`)

| File Path | Description | Relevance for Private Adaptation |
| :--- | :--- | :--- |
| **`overview.md`** | General architecture of the plugin system. | **Relevant**: Standard system introduction. |
| **`installation.md`** | Setup guide for agents and humans. | **Relevant**: Useful for reference when re-installing locally. |
| **`orchestration.md`** | Explains the Sisyphus/Hephaestus relationship. | **Relevant**: Helpful reference for multi-agent delegation behavior. |
| **`agent-model-matching.md`** | Maps task categories to LLM endpoints. | **Relevant**: Guides custom model mappings. |
| **`team-mode.md`** | Details parallel agent orchestration. | **Relevant**: Explains multi-agent task structures. |
| **`fork-maintenance-guide.md`** | Step-by-step procedures for managing downstream forks. | **Critical**: Directly guides how to merge upstream changes into this fork. |

### Reference Guides (`docs/reference/`)

| File Path | Description | Relevance for Private Adaptation |
| :--- | :--- | :--- |
| **`configuration.md`** | Full configuration options guide. | **Relevant**: Reference for local config modifications. |
| **`features.md`** | Feature lists (LSP, AST-grep, hashline, etc.). | **Relevant**: General feature documentation. |
| **`cross-project-mailbox.md`** | Mailbox operation and intent budgets runbook. | **Relevant**: Runbook for cross-project communication configurations. |
| **`hooks-and-tools.md`** | Full hook structure index. | **Relevant**: Diagnostic documentation. |
| **`agent-harness-fork-customizations-roadmap.md`** | Internal fork adaptations ledger. | **Critical**: Chronically details differences between upstream and local branches. |
| **`prompt-async-gate-rfc.md`** | Details prompt concurrency safety invariants. | **Relevant**: Technical reference. |
| **`cli.md`** | Command-line interface manual. | **Relevant**: Local CLI reference. |
| **`release-process.md`** | Upstream release sequence. | **Low Relevance**: Relates to public releases. |
| **`lazycodex-npm-reservation.md`** | Legacy npm package allocation notes. | **Low Relevance**: Out of scope for an OpenCode-focused private fork. |
