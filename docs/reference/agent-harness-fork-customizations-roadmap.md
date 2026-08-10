> **DOCUMENTATION METADATA**
> - **Origin**: Fork-Local (`rustybret/agent-harness`)
> - **Support Status**: Supported (Fork-Specific)
> - **Notes**: Architectural roadmap for fork customizations in agent-harness.

# agent-harness Fork Customizations Roadmap

## Status: MIGRATION COMPLETE — fork/local branch active as default

Generated: 2026-06-01 | Commits analyzed: 41 (origin/dev..origin/fork/local)

---

## Summary

| Category | Count |
|----------|-------|
| Total fork commits | 41 |
| Tier 1 — Must preserve on fork/local | 13 |
| Tier 2 — Fork infrastructure | 26 |
| Tier 3 — Drop / superseded | 2 |

---

## Summary Table

| SHA (short) | Subject | Tier | Action |
|-------------|---------|------|--------|
| 6b3d3eea0 | utils model refresh shell script | 2 | Preserved |
| 5274db85b | models metadata script for building opencode/omo config files | 2 | Preserved |
| cf7a953c5 | clean up ignored generated files from models.sh script | 2 | Preserved |
| 48cc23411 | model config benchmark | 2 | Preserved |
| b02a62ceb | update and run from dev commands | 2 | Preserved |
| fddb8a28f | ignore local workspace file | 2 | Preserved |
| 9d047fe5b | Update model-capabilities.generated.json | 2 | Preserved |
| 5b27d95f6 | coordination notes folder for teams | 2 | Preserved |
| afd1cabbf | fix(utils): correct jq filter for models-super-slim.json | 2 | Preserved |
| 748154889 | fix(utils): rename output files to models.json, models+variants.json | 2 | Preserved |
| ac31a523f | fix(utils): simplify models+variants.json variant format | 2 | Preserved |
| b919f3ea4 | fix(utils): write raw output files to utils/temp/ | 2 | Preserved |
| 992dd0424 | feat(utils): enhance models.sh with versioning, validation, cleanup | 2 | Preserved |
| 01c882577 | fix(utils): move output files inside utils/ directory | 2 | Preserved |
| 7c27c2ef5 | chore(utils): commit remaining file changes for utils/ output restructuring | 2 | Preserved |
| fcaabd1fd | chore: remove root json files | 2 | Preserved |
| ba44431a6 | docs(utils): document LSP and MCP integration steps | 2 | Preserved |
| b89e5c2c9 | ignore regenerated models | 2 | Preserved |
| f27984624 | chore: regenerate model-capabilities baseline (2383 models) | 2 | Preserved |
| af3e771ed | add just lsp support for .just files | 1 | Preserved |
| c1c285386 | Cerebras provider quirks | 1 | Preserved |
| 09017b028 | wire provider-quirks-normalizer into transform pipeline | 1 | Preserved |
| 51d37d4ef | fix(cerebras): strip reasoning_content from message info | 1 | Preserved |
| 3f723c62a | Final fix for Cerebras provider quirks | 1 | Preserved |
| a851c352c | chore(fork): remove orphan src/tools/lsp/ directory | 2 | Preserved |
| 52c276557 | feat(skills): add Ansible MCP skill | 1 | Preserved |
| 5975a2b85 | ci: fork workflows + submodule URL (.gitmodules → rustybret) | 1 | Preserved |
| 575483b69 | fix: correct YAML syntax in sync-upstream workflow | 1 | Preserved |
| 1f3bfbd38 | docs: add fork maintenance guide and workflow templates | 2 | Preserved |
| 91f555d6d | docs: generalize fork maintenance guide | 2 | Preserved |
| 1d18659ca | ci(fork): rewrite sync-upstream to rebase two-branch strategy | 1 | Preserved |
| 5d0ef0e0b | ci(fork): retarget CI to fork/local, deactivate upstream-only workflows | 1 | Preserved |
| 7175a2348 | docs(fork): rewrite fork-maintenance-guide for two-branch rebase model | 2 | Preserved |
| 1d145fe2d | ci(fork): sync fork-templates to live rebase-strategy workflow | 2 | Preserved |
| 7eb0cbf97 | chore(fork): track pre-commit hook and add install-hooks script | 2 | Preserved |
| 13e3c296e | fix(fork): add providerQuirksNormalizer to MessagesTransformHooks type | 1 | Preserved |
| aacab1c9c | fix(ci): use origin/dev and origin/fork/local explicitly | 1 | Preserved |
| 29c9fa7f9 | fix(ci): grant workflows:write permission (REVERTED — invalid permission) | 3 | Dropped |
| 3fe536315 | fix(ci): revert workflows:write permission | 3 | Dropped |
| 4c34dd1b5 | chore: gitignore cross-compiled platform binaries | 2 | Preserved |
| 2ea8769bd | chore(ci): trigger CI on fork/local (T18 validation, no-op) | 2 | Preserved |

---

## Tier 1 — Genuine Fork Customizations (Must Preserve)

These commits add genuine functionality that does not exist in upstream and must survive every rebase onto the latest upstream/dev.

### 1. JustFile LSP Support (`af3e771ed`)
**Files**: `packages/lsp-tools-mcp/src/lsp/language-mappings.ts`, `server-definitions.ts`
**What**: Adds `.just` / `Justfile` language mapping and `just-lsp` server definition to the LSP MCP.
**Why**: Enables IDE-level diagnostics and completions for Justfile syntax in OpenCode sessions.

### 2. Cerebras Provider Quirks (4 commits: `c1c285386`, `09017b028`, `51d37d4ef`, `3f723c62a`)
**Files**: `src/hooks/provider-quirks-normalizer/`, `src/hooks/index.ts`, `src/plugin/hooks/create-transform-hooks.ts`, `src/plugin/messages-transform.ts`
**What**: Adds a `providerQuirksNormalizer` transform hook that strips `reasoning_content` from Cerebras message info (Cerebras rejects this field that other providers accept). Wires it into the transform pipeline.
**Why**: Required for Cerebras API compatibility. Without this, Cerebras requests fail.

### 3. Fix: providerQuirksNormalizer Type (`13e3c296e`)
**Files**: `src/hooks/transform-message/types.ts` (or equivalent MessagesTransformHooks interface)
**What**: Adds `providerQuirksNormalizer` to the `MessagesTransformHooks` TypeScript type. Required for the build to pass after cherry-picking the Cerebras commits.
**Why**: Build gate — this commit makes the TypeScript type match the runtime implementation.

### 4. Ansible MCP Skill (`52c276557`)
**Files**: `.agents/skills/ansible-mcp/`, `.opencode/skills/ansible-mcp/SKILL.md`
**What**: Adds the Ansible MCP skill for playbook, inventory, role, and collection management via the vscode-ansible MCP server.
**Why**: Fork-specific skill extension for Ansible automation workflows.

### 5. Fork Workflows + Submodule URL (`5975a2b85`)
**Files**: `.gitmodules` (URL → `rustybret/lsp-tools-mcp`), `.github/workflows/` (fork adaptations)
**Why**: The `.gitmodules` change is the core fork pinning. Without it, `git submodule update` pulls upstream's lsp-tools-mcp instead of our fork.

### 6. Sync Workflow YAML Fix (`575483b69`)
**Files**: `.github/workflows/sync-upstream.yml`
**Why**: Corrects YAML syntax error that prevented the workflow from being recognized by GitHub Actions.

### 7. Rewrite sync-upstream to rebase strategy (`1d18659ca`)
**Files**: `.github/workflows/sync-upstream.yml`
**What**: Full rewrite from merge-strategy to two-branch rebase strategy (dev fast-forward + fork/local rebase).
**Why**: Core of the fork topology design.

### 8. Retarget CI to fork/local (`5d0ef0e0b`)
**Files**: `.github/workflows/ci.yml`, deactivated upstream-only workflows
**Why**: CI must run on fork/local (our branch), not main/dev.

### 9. Fix CI checkout ambiguity (`aacab1c9c`)
**Files**: `.github/workflows/sync-upstream.yml`
**What**: Uses `git checkout -B dev origin/dev` explicitly (was just `git checkout dev` which was ambiguous between local and remote).
**Why**: Fixed the "fatal: reference is not a tree" crash during sync runs.

---

## Tier 2 — Fork Infrastructure (Preserve, Updated Over Time)

These commits add fork-specific infrastructure that is not upstream content but may evolve:

- **utils/** model scripts (`models.sh`, benchmark, refresh): Local dev utility scripts for querying and formatting model capability data. Not needed in upstream but useful for config authoring.
- **model-capabilities.generated.json** updates: Regenerated from live API — regenerated automatically on dev but we keep a baseline.
- **coordination_notes/**: Local team coordination notes, not for upstream.
- **.githooks/pre-commit + scripts/install-hooks.sh**: Fork-specific pre-commit hook (runs `utils/models.sh` refresh). Tracked via install script.
- **docs/guide/fork-maintenance-guide.md**: The fork SOP guide.
- **docs/reference/opencode-fork-customizations-roadmap.md**: Companion inventory for the opencode fork.
- **.github/fork-templates/**: Reusable workflow templates for applying this pattern to other forks.
- **Removal of orphan `src/tools/lsp/`**: Cleanup of the broken LSP experiment from before the rebase.
- **.gitignore** additions (platform binaries, local workspace files, utils/temp).

---

## Tier 3 — Dropped (Do Not Cherry-Pick)

| SHA | Subject | Reason |
|-----|---------|--------|
| 29c9fa7f9 | fix(ci): grant workflows:write permission | Reverted — GITHUB_TOKEN does not support this scope. Would fail YAML validation. |
| 3fe536315 | fix(ci): revert workflows:write permission | Cleanup commit for the above revert. |

---

## Known Architectural Limitation

### GitHub App Token Cannot Push Workflow Files

The sync-upstream workflow fast-forwards `origin/dev` to `upstream/dev`. When upstream releases include changes to `.github/workflows/*.yml` files, the `git push origin dev` step is **rejected by GitHub** with:

```
remote: error: GH006: Protected email address. Refusing to allow GitHub App to update workflow files.
```

This is a platform-level restriction: the default `GITHUB_TOKEN` (GitHub App) cannot modify workflow files.

**Workaround**: Push those batches manually from a machine with write credentials:
```bash
git fetch upstream
git push origin upstream/dev:dev   # or: git checkout dev && git merge --ff-only upstream/dev && git push
```

**Long-term fix**: Provision a Personal Access Token (PAT) with `workflow` scope, store as repo secret `SYNC_PAT`, and update sync-upstream.yml to use `token: ${{ secrets.SYNC_PAT }}` in the checkout step.

---

## Reconstruction Plan

If fork/local is ever lost and must be rebuilt from dev, cherry-pick in this order (oldest first):

```
6b3d3eea0  utils model refresh shell script
5274db85b  models metadata script
cf7a953c5  clean up ignored generated files
48cc23411  model config benchmark
b02a62ceb  update and run from dev commands
fddb8a28f  ignore local workspace file
9d047fe5b  Update model-capabilities.generated.json
5b27d95f6  coordination notes folder
afd1cabbf  fix(utils): correct jq filter
748154889  fix(utils): rename output files
ac31a523f  fix(utils): simplify models+variants format
b919f3ea4  fix(utils): write raw output files to utils/temp/
992dd0424  feat(utils): enhance models.sh
01c882577  fix(utils): move output files
7c27c2ef5  chore(utils): commit remaining file changes
fcaabd1fd  chore: remove root json files
ba44431a6  docs(utils): document LSP and MCP steps
b89e5c2c9  ignore regenerated models
f27984624  chore: regenerate model-capabilities baseline
af3e771ed  add just lsp support
c1c285386  Cerebras provider quirks
09017b028  wire provider-quirks-normalizer
51d37d4ef  fix(cerebras): strip reasoning_content
3f723c62a  Final fix for Cerebras provider quirks
a851c352c  chore(fork): remove orphan src/tools/lsp/
52c276557  feat(skills): add Ansible MCP skill
5975a2b85  ci: fork workflows + submodule URL
575483b69  fix: correct YAML syntax in sync-upstream
1f3bfbd38  docs: add fork maintenance guide
91f555d6d  docs: generalize fork maintenance guide
1d18659ca  ci(fork): rewrite sync-upstream to rebase strategy
5d0ef0e0b  ci(fork): retarget CI, deactivate upstream-only workflows
7175a2348  docs(fork): rewrite maintenance guide two-branch model
1d145fe2d  ci(fork): sync fork-templates to live rebase pattern
7eb0cbf97  chore(fork): track pre-commit hook
13e3c296e  fix(fork): add providerQuirksNormalizer type
aacab1c9c  fix(ci): use origin/dev and origin/fork/local explicitly
4c34dd1b5  chore: gitignore cross-compiled platform binaries
```

---

## Execution Status

- [x] Forensic inventory complete
- [x] fork/local branch created (Task 6)
- [x] Commits reconstructed on fork/local (Task 7)
- [x] Topology verified: dev == upstream/dev, fork/local descends dev
- [x] Default branch set to fork/local
- [x] Sync workflow rewritten to rebase strategy
- [ ] Upstream workflow-file push limitation resolved (pending PAT provisioning)
