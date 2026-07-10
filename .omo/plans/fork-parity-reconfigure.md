# Reconfigure agent-harness Fork to Two-Branch Parity with opencode

## TL;DR

> **Quick Summary**: Migrate the agent-harness fork from its single-`main` (merge-based) topology to the opencode fork's two-branch model — a pristine `dev` (fast-forward mirror of `upstream/dev`, zero customizations) plus `fork/local` (thin customization layer rebased on `dev`) — and bring all workflows, submodule pinning, hooks, and docs to full parity. The migration rewrites git history on the fork's default branch, so it is gated behind a forensic inventory and immutable backups before any branch surgery.
>
> **Deliverables**:
> - Forensic inventory of agent-harness's 61 fork commits (Tier1/Tier2/Tier3 classification)
> - Immutable pre-migration backups (git bundle + remote `backup/main-pre-migration-{date}` branch + ref manifest)
> - Clean `dev` branch = byte-for-byte mirror of `upstream/dev`
> - `fork/local` branch = reconstructed customizations rebased on `dev`, set as default
> - Rebase-based `sync-upstream.yml` (replaces merge strategy) + `ci.yml` retargeted to `fork/local`
> - Workflow fate table applied (keep/disable/retarget each of the 11 workflows)
> - `lsp-tools-mcp` submodule override preserved on `fork/local`, absent from `dev`
> - Rewritten `fork-maintenance-guide.md` (two-branch SOP) + updated `.github/fork-templates/`
> - End-to-end proof: manual sync run + CI run both green; rollback path documented
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves (heavy serial dependency in the migration core)
> **Critical Path**: Inventory → Backups → dev mirror → fork/local reconstruct → workflows/docs on fork/local → push (force-with-lease) → default-branch switch → sync+CI verification

---

## Context

### Original Request
"reconfigure this repo fork using the same setup as we are now using with opencode local fork. see your docs for more info or the repo at ~/Git/opencode"

- **Target**: agent-harness (`/Volumes/Topper2TB/Git/agent-harness` = `rustybret/agent-harness`)
- **Reference**: opencode fork (`~/Git/opencode` = `rustybret/opencode`), already migrated to the two-branch model

### Interview Summary
**Key Discussions**:
- Scope: user selected **Option 4 — FULL PARITY** (workflows + branch topology + submodule strategy + pre-commit hooks + utils + guide doc).
- Branch migration: user selected **Exact parity** — create clean `dev`, move customizations to `fork/local`, make `fork/local` the default working branch.

**Research Findings** (two explore agents):
- **opencode (reference)**: branches `dev` (FF mirror, zero customizations) + `fork/local` (customization layer) + `backup/dev-pre-migration-20260531`. `sync-upstream.yml` uses REBASE strategy (checkout -B dev upstream/dev FF-only, rebase fork/local, abort + open ISSUE on conflict). `ci.yml` runs only on `fork/local`. opencode's own `.github/fork-templates/` are STALE (merge/single-main) and do not match its live workflows.
- **agent-harness (target)**: single `main` (default+working), ANOMALY — `main` tracks `upstream/dev` not `origin`. 61 fork commits; `upstream/dev` 409 ahead. `sync-upstream.yml` uses MERGE strategy targeting `main`. 11 workflows total (sync-upstream, ci, local-build, web-ci, web-deploy, publish, publish-platform, sisyphus-agent, cla, refresh-model-capabilities, lint-workflows). Submodule `packages/lsp-tools-mcp` → `rustybret/lsp-tools-mcp` on `local/enhancements`. Plain-shell pre-commit hook runs `utils/models.sh`. Existing doc `docs/reference/opencode-fork-customizations-roadmap.md` is for the OPENCODE fork, not agent-harness.

### Metis Review
**Identified Gaps** (addressed):
- Missing agent-harness forensic inventory is the real blocker, not the YAML — added as the first task, gating all branch surgery.
- Destructive history-rewrite guardrails made explicit: immutable backups, `--force-with-lease` with expected old SHAs, preserve `main`, do not prune feature branches, `dev` byte-for-byte mirror gate.
- Required sequence enforced: inventory + backups BEFORE branch surgery; sync+CI end-to-end proof AFTER.
- Workflow fate must be decided per-workflow (keep/disable/retarget/delete).
- Rollback path must be in the plan.

---

## Work Objectives

### Core Objective
Reconfigure the agent-harness fork to the opencode two-branch topology (`dev` clean mirror + `fork/local` customization layer) with full parity across workflows, submodule pinning, hooks, and docs — executed safely behind a forensic inventory and immutable backups, with end-to-end proof that upstream-sync and CI work.

### Concrete Deliverables
- `docs/reference/agent-harness-fork-customizations-roadmap.md` (forensic inventory of 61 commits)
- Pre-migration backup artifacts: `/tmp/agent-harness-pre-migration-{date}.bundle`, ref manifest files, `origin/backup/main-pre-migration-{date}` branch
- `origin/dev` (clean FF mirror of `upstream/dev`)
- `origin/fork/local` (reconstructed customizations, default branch)
- `.github/workflows/sync-upstream.yml` (rebase strategy, dev+fork/local)
- `.github/workflows/ci.yml` (triggers on fork/local)
- Workflow fate table applied across all 11 workflows
- `.gitmodules` + `packages/lsp-tools-mcp` pin present on `fork/local`, absent on `dev`
- `docs/guide/fork-maintenance-guide.md` (rewritten two-branch SOP)
- `.github/fork-templates/{sync-upstream,ci-private-fork,local-build}.yml` (updated to live rebase pattern)
- Documented + tracked pre-commit hook install step
- Rollback runbook section in the guide

### Definition of Done
- [x] `git diff --exit-code origin/dev upstream/dev` returns 0 (clean mirror)
- [x] `git rev-list --count --left-right origin/dev...upstream/dev` returns `0	0`
- [x] `git merge-base --is-ancestor origin/dev origin/fork/local` returns 0
- [x] `gh repo view rustybret/agent-harness --json defaultBranchRef -q '.defaultBranchRef.name'` returns `fork/local`
- [x] `origin/backup/main-pre-migration-{date}` equals the recorded pre-migration `origin/main` SHA
- [x] Manual `sync-upstream.yml` run completes with conclusion `success`
- [x] Manual `ci.yml` run on `fork/local` completes `success` (or only documented pre-existing failures)
- [x] `bun run typecheck` and `bun run build` pass on `fork/local`
- [x] Submodule URL = rustybret fork, branch = `local/enhancements` on `fork/local`

### Must Have
- Forensic inventory completed and reviewed BEFORE any branch surgery
- Immutable backups (bundle + remote backup branch + ref manifest) before any force-push
- `dev` is a zero-customization mirror of `upstream/dev`
- `--force-with-lease` (never plain `--force`) for all history-rewriting pushes
- `main` preserved until all acceptance criteria pass and ≥1 scheduled sync succeeds
- Documented rollback path

### Must NOT Have (Guardrails)
- No reconstruction of the 61 commits by intuition (inventory-driven only)
- No `.gitmodules` or fork-only workflow changes on `dev`
- No pruning/rebasing of existing feature branches (fix/*, refactor/*, my-changes, etc.)
- No changes to package versions, publish semantics, Cloudflare deploy config, or dependencies
- No source-code edits unless the inventory PROVES a fork customization must be preserved
- No plain `git push --force`
- No deletion of `main` during this migration
- No fixing of unrelated CI failures or unrelated workflow modernization

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verification is agent-executed via git state assertions, actionlint, and gh CLI.

### Test Decision
- **Infrastructure exists**: N/A for YAML/git topology (no unit-test harness for workflows)
- **Automated tests**: None (git/YAML migration); existing `bun test` suite is a regression guard only
- **Framework**: actionlint (workflow YAML), git plumbing assertions, gh CLI (run status), bun (build/typecheck regression)

### QA Policy
Every task includes agent-executed QA scenarios with concrete commands and expected output. Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Git topology**: `git rev-parse`, `git diff --exit-code`, `git rev-list --left-right`, `git merge-base --is-ancestor`
- **Workflow YAML**: `actionlint`, `gh workflow list`, `grep` for branch targets
- **End-to-end**: `gh workflow run` + `gh run view --log` assertions
- **Build regression**: `bun run typecheck`, `bun run build`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Read-only prep — start immediately, fully parallel):
├── Task 1: Pre-migration ref manifest + SHA recording [quick]
├── Task 2: Immutable backups (bundle + remote backup branch) [quick]
├── Task 3: Forensic inventory of 61 fork commits [ultrabrain]
├── Task 4: Environment/preconditions verification (Issues enabled, gh auth, remotes) [quick]
└── Task 5: Workflow fate table decision doc [unspecified-high]

Wave 2 (Branch surgery — serial core, depends on Wave 1):
├── Task 6: Create clean local `dev` from upstream/dev + verify mirror (depends: 1,2,3) [deep]
└── Task 7: Reconstruct `fork/local` from classified customizations (depends: 3,6) [ultrabrain]

Wave 3 (Content on fork/local — parallel, depends on Task 7):
├── Task 8: Rewrite sync-upstream.yml to rebase strategy (depends: 5,7) [deep]
├── Task 9: Retarget ci.yml to fork/local + apply workflow fate table (depends: 5,7) [unspecified-high]
├── Task 10: Verify/preserve lsp-tools-mcp submodule pin on fork/local (depends: 7) [quick]
├── Task 11: Rewrite fork-maintenance-guide.md to two-branch SOP (depends: 7) [writing]
├── Task 12: Update .github/fork-templates/* to live rebase pattern (depends: 7) [unspecified-high]
└── Task 13: Document + track pre-commit hook install (depends: 7) [quick]

Wave 4 (Publish + prove — serial, depends on Wave 3):
├── Task 14: Local build/typecheck regression on fork/local (depends: 8-13) [quick]
├── Task 15: Push dev + fork/local + backup with --force-with-lease (depends: 14) [deep]
├── Task 16: Switch GitHub default branch to fork/local + branch protections (depends: 15) [quick]
├── Task 17: Manual sync-upstream end-to-end run + log assertions (depends: 16) [deep]
└── Task 18: Manual CI end-to-end run on fork/local + rollback runbook validation (depends: 16) [deep]

Wave FINAL (after ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Workflow/YAML + git-topology quality review (unspecified-high)
├── Task F3: Real end-to-end QA re-execution (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: 3 → 6 → 7 → (8..13) → 14 → 15 → 16 → 17/18 → F1-F4 → user okay
Max Concurrent: 5 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | - | 6, 15 |
| 2 | 1 | 6, 15 |
| 3 | - | 6, 7 |
| 4 | - | 16, 17 |
| 5 | - | 8, 9 |
| 6 | 1, 2, 3 | 7 |
| 7 | 3, 6 | 8-13 |
| 8 | 5, 7 | 14 |
| 9 | 5, 7 | 14 |
| 10 | 7 | 14 |
| 11 | 7 | 14 |
| 12 | 7 | 14 |
| 13 | 7 | 14 |
| 14 | 8-13 | 15 |
| 15 | 14 | 16 |
| 16 | 4, 15 | 17, 18 |
| 17 | 16 | F1-F4 |
| 18 | 16 | F1-F4 |

### Agent Dispatch Summary

| Wave | Count | Dispatch |
|------|-------|----------|
| 1 | 5 | T1→quick, T2→quick, T3→ultrabrain, T4→quick, T5→unspecified-high |
| 2 | 2 | T6→deep, T7→ultrabrain |
| 3 | 6 | T8→deep, T9→unspecified-high, T10→quick, T11→writing, T12→unspecified-high, T13→quick |
| 4 | 5 | T14→quick, T15→deep, T16→quick, T17→deep, T18→deep |
| FINAL | 4 | F1→oracle, F2→unspecified-high, F3→unspecified-high, F4→deep |

---

## TODOs

- [x] 1. Record pre-migration ref manifest and SHAs

  **What to do**:
  - `git -C /Volumes/Topper2TB/Git/agent-harness fetch origin upstream --prune`
  - Save: `git show-ref --heads --tags > /tmp/agent-harness-pre-refs-{date}.txt`
  - Save: `git rev-parse origin/main > /tmp/agent-harness-old-main-sha.txt`
  - Save: `git ls-tree origin/main packages/lsp-tools-mcp > /tmp/agent-harness-pre-submodule.txt`
  - Save: `git config -f .gitmodules --get-regexp '^submodule\.' > /tmp/agent-harness-pre-gitmodules.txt`
  - Record all origin branch SHAs (fix/*, refactor/*, my-changes, master, omo-ultrawork-web, o-slashcommand) to the manifest.
  - Copy these artifacts into `.omo/evidence/` as well for durability.

  **Must NOT do**: Modify any ref. Read-only recording only.

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: mechanical git recording, no judgment.
  - **Skills**: [`git-master`] — git plumbing commands. Omitted: none relevant.

  **Parallelization**: Can Run In Parallel: YES | Wave 1 | Blocks: 6,15 | Blocked By: None

  **References**:
  - Pattern: opencode migration used the same manifest approach — see `docs/reference/opencode-fork-customizations-roadmap.md` (Execution Status section, backups retained).
  - WHY: This manifest is the source of truth for `--force-with-lease` expected-old SHAs and rollback.

  **Acceptance Criteria**:
  - QA Scenario (happy): record manifest
    ```
    Tool: Bash
    Steps:
      1. Run the 4 save commands above
      2. cat /tmp/agent-harness-old-main-sha.txt
      3. assert it contains exactly one 40-hex SHA
      4. wc -l /tmp/agent-harness-pre-refs-{date}.txt  (>= number of origin branches)
    Expected Result: all files non-empty; old-main-sha is a valid commit (`git cat-file -t <sha>` == commit)
    Evidence: .omo/evidence/task-1-manifest.txt
    ```
  - QA Scenario (negative): `git cat-file -t $(cat /tmp/agent-harness-old-main-sha.txt)` must print `commit`; if `fatal: Not a valid object`, FAIL.
  - Evidence: .omo/evidence/task-1-manifest.txt

  **Commit**: NO (artifacts to /tmp + .omo/evidence)

- [x] 2. Create immutable pre-migration backups

  **What to do**:
  - `git bundle create /tmp/agent-harness-pre-migration-{date}.bundle --all`
  - Create remote backup branch from current origin/main: `git push origin origin/main:refs/heads/backup/main-pre-migration-{date}` (or local branch then push).
  - Optionally tag: `git tag backup/main-pre-migration-{date} <old-main-sha>` and push the tag.
  - Verify bundle integrity: `git bundle verify /tmp/agent-harness-pre-migration-{date}.bundle`.

  **Must NOT do**: Delete or overwrite anything. Do not force-push. This task only ADDS backups.

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: mechanical backup creation.
  - **Skills**: [`git-master`] — bundle + push plumbing.

  **Parallelization**: Can Run In Parallel: YES (after T1 records SHA) | Wave 1 | Blocks: 6,15 | Blocked By: 1

  **References**:
  - Pattern: opencode kept `backup/dev-pre-migration-20260531` branch + tag at `567d396ea` — replicate that exact backup convention.
  - WHY: This is the rollback anchor. Without it, the force-push in Task 15 is unrecoverable.

  **Acceptance Criteria**:
  - QA Scenario (happy): backups exist
    ```
    Tool: Bash
    Steps:
      1. git bundle verify /tmp/agent-harness-pre-migration-{date}.bundle
      2. git rev-parse origin/backup/main-pre-migration-{date}
      3. assert step-2 SHA == cat /tmp/agent-harness-old-main-sha.txt
    Expected Result: bundle verifies OK; backup branch SHA equals recorded old-main SHA
    Evidence: .omo/evidence/task-2-backups.txt
    ```
  - QA Scenario (negative): if `git rev-parse origin/backup/main-pre-migration-{date}` errors (branch absent), FAIL — do not proceed to any branch surgery.
  - Evidence: .omo/evidence/task-2-backups.txt

  **Commit**: NO (git refs + bundle artifact)

- [x] 3. Build forensic inventory of the 61 fork commits

  **What to do**:
  - Enumerate fork-only commits: `git log --oneline upstream/dev..origin/main` (and `--no-merges` variant). Expect ~61.
  - For EACH commit, classify into: **Tier 1** (genuine fork customization that must be preserved — e.g. lsp-tools-mcp submodule override, fork CI/sync workflows, fork docs), **Tier 2** (fork infrastructure — workflows, templates, utils), **Tier 3** (superseded by upstream / already merged / obsolete — drop).
  - For each Tier 1/2 commit, record: SHA, subject, files touched, and the reconstruction action (cherry-pick, re-apply, or fold).
  - Detect duplicate/rebase-polluted commits (the session history noted repeated `rebase -X theirs` duplication on the opencode fork; check agent-harness for the same).
  - Write `docs/reference/agent-harness-fork-customizations-roadmap.md` mirroring the structure of the existing opencode roadmap doc.

  **Must NOT do**: Do not start any branch surgery. Do not cherry-pick yet. Inventory + doc only. Do not edit source files.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain` — Reason: classification of 61 commits requires judgment about what is genuine customization vs upstream-superseded; high-stakes correctness (drives the blind-spot-free reconstruction).
  - **Skills**: [`git-master`] — log/blame/diff archaeology. Omitted: others (no external libs).

  **Parallelization**: Can Run In Parallel: YES | Wave 1 | Blocks: 6,7 | Blocked By: None

  **References**:
  - Pattern: `docs/reference/opencode-fork-customizations-roadmap.md` — copy its Tier 1/2/3 structure, "must re-implement / fork infra / superseded" framing, and execution-status section.
  - Data: `git log upstream/dev..origin/main`, `git diff upstream/dev...origin/main --stat`.
  - WHY: This is the prerequisite Metis flagged — reconstruction of fork/local (Task 7) consumes this classification directly.

  **Acceptance Criteria**:
  - QA Scenario (happy): inventory completeness
    ```
    Tool: Bash + Read
    Steps:
      1. N=$(git rev-list --count upstream/dev..origin/main)
      2. Read docs/reference/agent-harness-fork-customizations-roadmap.md
      3. assert every one of N commits appears (by SHA) with a Tier classification
      4. assert lsp-tools-mcp submodule override is classified Tier 1
    Expected Result: 100% of fork commits classified; Tier 1 list includes submodule override + fork workflows
    Evidence: .omo/evidence/task-3-inventory.txt
    ```
  - QA Scenario (negative): if any commit SHA from `git rev-list upstream/dev..origin/main` is absent from the doc, FAIL (blind spot).
  - Evidence: .omo/evidence/task-3-inventory.txt

  **Commit**: YES — `docs(fork): add agent-harness customizations forensic inventory` (files: docs/reference/agent-harness-fork-customizations-roadmap.md). NOTE: commit to a scratch branch off main or to main directly is fine here since it is additive doc only and predates branch surgery; the doc will be carried onto fork/local in Task 7.

- [x] 4. Verify environment preconditions

  **What to do**:
  - Confirm `gh auth status` is authenticated for `rustybret`.
  - Confirm GitHub Issues are ENABLED on `rustybret/agent-harness`: `gh repo view rustybret/agent-harness --json hasIssuesEnabled -q '.hasIssuesEnabled'` → must be `true` (the rebase sync workflow opens an issue on conflict). If `false`, record a plan note to enable Issues OR switch the conflict path to a PR.
  - Confirm Actions can create issues (workflow `permissions: issues: write` + repo Actions setting allows it).
  - Confirm remotes: origin=rustybret/agent-harness, upstream=code-yeongyu/oh-my-openagent.
  - Record current GitHub default branch.

  **Must NOT do**: Do not change any setting yet; record findings only.

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: read-only gh API checks.
  - **Skills**: [] — gh CLI only.

  **Parallelization**: Can Run In Parallel: YES | Wave 1 | Blocks: 16,17 | Blocked By: None

  **References**:
  - WHY: opencode's sync workflow opens an Issue on conflict; if Issues are disabled on agent-harness the conflict path silently fails. This must be known before Task 8 designs the workflow.

  **Acceptance Criteria**:
  - QA Scenario (happy): preconditions captured
    ```
    Tool: Bash
    Steps:
      1. gh auth status
      2. gh repo view rustybret/agent-harness --json hasIssuesEnabled,defaultBranchRef
      3. git remote -v
    Expected Result: authenticated; hasIssuesEnabled recorded (true/false); remotes match expected URLs
    Evidence: .omo/evidence/task-4-preconditions.json
    ```
  - QA Scenario (negative): if Issues disabled, the evidence MUST contain an explicit follow-up note; Task 8 then must not assume issue-creation works.
  - Evidence: .omo/evidence/task-4-preconditions.json

  **Commit**: NO

- [x] 5. Produce the workflow fate decision table

  **What to do**:
  - For each of the 11 workflows, record the decision + rationale (defaults below; honor any user overrides from the plan summary):
    - sync-upstream.yml → REWRITE (rebase strategy) [Task 8]
    - ci.yml → RETARGET to fork/local [Task 9]
    - local-build.yml → KEEP (repository_dispatch, already matches) — verify only
    - web-ci.yml → KEEP, retarget branch refs to new scheme
    - web-deploy.yml → KEEP, retarget branch refs to new scheme
    - publish.yml → KEEP as-is (self-gated repo==code-yeongyu, inert on fork)
    - publish-platform.yml → KEEP as-is (workflow_call/dispatch, inert on fork)
    - cla.yml → DEACTIVATE or REMOVE (D2: contributor/team-management workflow not relevant to a private fork — CLA assistant for upstream's external contributors)
    - sisyphus-agent.yml → DEACTIVATE or REMOVE (D2: upstream community automation — @mention AI agent that triages the upstream project's issues/PRs; not for a private fork)
    - refresh-model-capabilities.yml → KEEP (guarded upstream-only; pure maintenance, not team/contributor management)
    - lint-workflows.yml → KEEP (useful)
  - **D2 principle**: any workflow whose purpose is managing the UPSTREAM project's contributors/team/community is removed or deactivated on this private fork. Default to DEACTIVATE (neutralize triggers — e.g. reduce to `workflow_dispatch`-only or add an `if: github.repository == 'code-yeongyu/oh-my-openagent'` guard so it cannot fire on the fork) so future upstream merges stay conflict-free; REMOVE only if the user prefers a clean tree. Record the chosen sub-option (deactivate vs remove) per workflow in the table.
  - Write the table into the fork-maintenance guide draft section (consumed by Tasks 9, 11, 12).

  **Must NOT do**: Do not modify any workflow file in this task (decision-only).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: requires reasoning about each workflow's fork-safety and parity impact.
  - **Skills**: [] — analysis + writing.

  **Parallelization**: Can Run In Parallel: YES | Wave 1 | Blocks: 8,9 | Blocked By: None

  **References**:
  - Data: agent-harness `.github/workflows/` (11 files), opencode `.github/workflows/` (dev+fork/local set).
  - WHY: Metis requires an explicit keep/disable/retarget/delete decision per workflow before editing.

  **Acceptance Criteria**:
  - QA Scenario (happy): table covers all 11
    ```
    Tool: Read + Bash
    Steps:
      1. ls .github/workflows/*.yml | wc -l  (== 11)
      2. assert the decision table lists a verdict for each of the 11 filenames
    Expected Result: 11/11 workflows have an explicit decision + rationale
    Evidence: .omo/evidence/task-5-fate-table.md
    ```
  - Evidence: .omo/evidence/task-5-fate-table.md

  **Commit**: YES — `docs(fork): add workflow fate decision table` (folded into guide or evidence; final home is the guide in Task 11).

- [x] 6. Create clean local `dev` from upstream/dev and verify mirror

  **What to do**:
  - Work in a fresh clone or the main worktree with a clean tree (verify `git status` clean first).
  - `git fetch upstream --prune`
  - `git checkout -B dev upstream/dev` (fast-forward only; `dev` must equal `upstream/dev` exactly).
  - Hard-gate verify locally (do NOT push yet — push is Task 15): `git diff --exit-code dev upstream/dev` and `git rev-list --count --left-right dev...upstream/dev` → `0	0`.
  - Confirm `dev` carries NO fork customizations: `.gitmodules` should be upstream's version (no rustybret override), no fork-only workflows beyond what upstream ships.

  **Must NOT do**: Do NOT push dev yet. Do NOT add .gitmodules override or any fork file to dev. Do NOT touch main.

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: must reason about clean-tree safety and the mirror invariant; autonomous handling of clone vs worktree.
  - **Skills**: [`git-master`] — branch creation, mirror verification.

  **Parallelization**: NO (serial core) | Wave 2 | Blocks: 7 | Blocked By: 1,2,3

  **References**:
  - Pattern: opencode `dev` force-reset to `upstream/dev` (abaabdcb7) as pristine mirror — replicate.
  - WHY: `fork/local` (Task 7) is built ON TOP of this clean dev; any contamination here propagates.

  **Acceptance Criteria**:
  - QA Scenario (happy): clean mirror
    ```
    Tool: Bash
    Steps:
      1. git checkout -B dev upstream/dev
      2. git diff --exit-code dev upstream/dev; echo $?   (==0)
      3. git rev-list --count --left-right dev...upstream/dev   (==0	0)
      4. git config -f .gitmodules --get submodule.packages/lsp-tools-mcp.url  (should be UPSTREAM url, not rustybret — or absent)
    Expected Result: dev byte-for-byte equals upstream/dev; no rustybret submodule override on dev
    Evidence: .omo/evidence/task-6-dev-mirror.txt
    ```
  - QA Scenario (negative): if `git diff dev upstream/dev` shows ANY diff, FAIL — dev is contaminated.
  - Evidence: .omo/evidence/task-6-dev-mirror.txt

  **Commit**: NO (branch creation; push deferred to Task 15)

- [x] 7. Reconstruct `fork/local` from classified customizations

  **What to do**:
  - `git checkout -b fork/local dev` (branch off the clean dev).
  - Using the Tier 1 + Tier 2 list from Task 3's inventory, re-apply ONLY genuine customizations via `git cherry-pick` (preserving authorship) or curated re-application. Skip all Tier 3 (superseded) commits.
  - Ensure these land on fork/local: lsp-tools-mcp `.gitmodules` override + submodule pin, fork workflows (will be finalized in Tasks 8-9-12), fork docs (incl. Task 3 inventory + Task 11 guide), pre-commit hook docs (Task 13), utils/models.sh if fork-specific.
  - Resolve cherry-pick conflicts deliberately (upstream moved 409 commits); document each non-trivial resolution.
  - Verify fork/local descends dev: `git merge-base --is-ancestor dev fork/local`.

  **Must NOT do**: Do NOT include Tier 3 commits. Do NOT reconstruct by intuition — follow the inventory. Do NOT push yet (Task 15). Do NOT prune/touch feature branches.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain` — Reason: the highest-stakes step; cherry-pick conflict resolution across a 409-commit upstream gap requires careful judgment to preserve exactly the genuine customizations.
  - **Skills**: [`git-master`] — cherry-pick, conflict resolution, authorship preservation.

  **Parallelization**: NO (serial core) | Wave 2 | Blocks: 8-13 | Blocked By: 3,6

  **References**:
  - Data: Task 3 inventory (`docs/reference/agent-harness-fork-customizations-roadmap.md`), Task 1 manifest.
  - Pattern: opencode `fork/local` created from clean dev (5de928b9b) with curated Tier 1+2 commits.
  - WHY: This IS the customization layer; correctness here determines whether the fork keeps working.

  **Acceptance Criteria**:
  - QA Scenario (happy): topology + customizations present
    ```
    Tool: Bash
    Steps:
      1. git merge-base --is-ancestor dev fork/local; echo $?   (==0)
      2. git config -f .gitmodules --get submodule.packages/lsp-tools-mcp.url   (== rustybret fork url)
      3. git config -f .gitmodules --get submodule.packages/lsp-tools-mcp.branch   (== local/enhancements)
      4. git log --oneline dev..fork/local | wc -l   (== count of Tier1+Tier2 commits from inventory)
    Expected Result: fork/local descends dev; submodule override present; only curated commits on top
    Evidence: .omo/evidence/task-7-fork-local.txt
    ```
  - QA Scenario (negative): if any Tier 3 SHA from the inventory appears in `git log dev..fork/local`, FAIL.
  - Evidence: .omo/evidence/task-7-fork-local.txt

  **Commit**: NO direct file commit (cherry-picks ARE the commits; push deferred to Task 15)

- [x] 8. Rewrite sync-upstream.yml to rebase two-branch strategy

  **What to do**:
  - Replace the merge-strategy workflow with the rebase strategy modeled on opencode's live `sync-upstream.yml`:
    - Fetch upstream; `git checkout -B dev upstream/dev` (FF-only); push dev.
    - Rebase `fork/local` onto fresh dev.
    - On conflict: ABORT the rebase and open a GitHub Issue (title + body with conflict details) for manual resolution; do NOT auto-resolve, do NOT force a partial state.
    - On success: push fork/local with `--force-with-lease`.
    - Schedule: `cron: '0 10 * * 1'` (Mon 10:00 UTC) + `workflow_dispatch` with `upstream_branch` input.
    - Permissions: `contents: write`, `issues: write`. Handle submodule update during rebase.
  - **CRITICAL (from T4):** GitHub Issues are DISABLED on rustybret/agent-harness. Use PR-based conflict path instead of issue-creation. Conflict action: `git rebase --abort`, then `gh pr create --title "Sync conflict" --body "..." --base fork/local --head <conflict-branch>`. Do NOT use `gh issue create`.

  **Must NOT do**: Do not keep any merge-strategy logic. Do not target `main`. Do not auto-resolve conflicts silently.

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: workflow logic with conflict-handling branches; must mirror opencode semantics precisely.
  - **Skills**: [] — YAML + gh Actions.

  **Parallelization**: Can Run In Parallel: YES | Wave 3 | Blocks: 14 | Blocked By: 5,7

  **References**:
  - Pattern: opencode `.github/workflows/sync-upstream.yml` (LIVE rebase version) — the canonical source. Read it directly from ~/Git/opencode.
  - Contrast: current agent-harness `.github/workflows/sync-upstream.yml` (merge version) — being replaced.
  - WHY: Parity requires the rebase+issue semantics, not the old merge+auto-resolve.

  **Acceptance Criteria**:
  - QA Scenario (happy): valid rebase workflow
    ```
    Tool: Bash
    Steps:
      1. actionlint .github/workflows/sync-upstream.yml
      2. grep -E "checkout -B dev upstream/dev" .github/workflows/sync-upstream.yml
      3. grep -E "rebase" .github/workflows/sync-upstream.yml
      4. grep -E "force-with-lease" .github/workflows/sync-upstream.yml
      5. grep -E "issues: write" .github/workflows/sync-upstream.yml
      6. assert NO "merge" auto-resolve strategy remains
    Expected Result: actionlint clean; rebase + dev reset + force-with-lease + issue path all present
    Evidence: .omo/evidence/task-8-sync-workflow.txt
    ```
  - QA Scenario (negative): `grep -i "git merge upstream" .github/workflows/sync-upstream.yml` returns nothing (old strategy fully removed).
  - Evidence: .omo/evidence/task-8-sync-workflow.txt

  **Commit**: YES — `ci(fork): rewrite sync-upstream to rebase two-branch strategy`

- [x] 9. Retarget ci.yml to fork/local and apply workflow fate table

  **What to do**:
  - Edit `ci.yml` so push/PR triggers target `fork/local` (remove `main`/`master`/`dev` triggers per parity; opencode CI runs only on fork/local). Add concurrency per-ref with cancel-in-progress.
  - Apply Task 5 fate table to the other workflows:
    - web-ci.yml / web-deploy.yml: retarget branch refs (master/dev → fork/local where they gate fork builds; keep path filters).
    - publish.yml / publish-platform.yml / refresh-model-capabilities.yml: leave self-gating intact (verify the `if: github.repository == 'code-yeongyu/...'` guards remain).
    - cla.yml AND sisyphus-agent.yml (D2 — contributor/team-management): DEACTIVATE (default) by neutralizing triggers so they cannot fire on the fork — either reduce `on:` to `workflow_dispatch`-only or add a top-level job guard `if: github.repository == 'code-yeongyu/oh-my-openagent'`. REMOVE the file(s) instead if a clean tree is preferred. Apply the same sub-option chosen in Task 5.
    - lint-workflows.yml, local-build.yml: keep; verify only.

  **Must NOT do**: Do not remove self-gating from publish/refresh workflows. Do not change publish/version/deploy semantics. Do not leave cla.yml or sisyphus-agent.yml able to fire on the fork.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: multi-file workflow retargeting with careful preservation of gating.
  - **Skills**: [] — YAML.

  **Parallelization**: Can Run In Parallel: YES | Wave 3 | Blocks: 14 | Blocked By: 5,7

  **References**:
  - Pattern: opencode `ci.yml` (fork/local-only triggers).
  - Data: Task 5 fate table.
  - WHY: CI must run on the new working branch or nothing is verified post-migration.

  **Acceptance Criteria**:
  - QA Scenario (happy): ci retargeted, gates intact
    ```
    Tool: Bash
    Steps:
      1. actionlint .github/workflows/*.yml
      2. grep -E "fork/local" .github/workflows/ci.yml
      3. assert no bare "main" push trigger remains in ci.yml
      4. grep -E "github.repository ==" .github/workflows/publish.yml .github/workflows/refresh-model-capabilities.yml  (gates still present)
    Expected Result: actionlint clean; ci targets fork/local; publish/refresh gates preserved
    Evidence: .omo/evidence/task-9-ci-retarget.txt
    ```
  - QA Scenario (negative): if publish.yml lost its repository guard, FAIL (could publish from fork).
  - Evidence: .omo/evidence/task-9-ci-retarget.txt

  **Commit**: YES — `ci(fork): retarget ci.yml to fork/local; apply workflow fate table`

- [x] 10. Verify and preserve lsp-tools-mcp submodule pin on fork/local

  **What to do**:
  - Confirm `.gitmodules` on fork/local has `url = https://github.com/rustybret/lsp-tools-mcp.git` and `branch = local/enhancements`.
  - Confirm the gitlink SHA matches the pre-migration recorded value (Task 1) unless intentionally updated.
  - Confirm `dev` does NOT carry this override (it should have upstream's submodule config or none).

  **Must NOT do**: Do not change the submodule contents. Do not add the override to dev.

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: verification of a specific config pair.
  - **Skills**: [`git-master`] — submodule plumbing.

  **Parallelization**: Can Run In Parallel: YES | Wave 3 | Blocks: 14 | Blocked By: 7

  **References**:
  - Data: Task 1 `/tmp/agent-harness-pre-submodule.txt`, `/tmp/agent-harness-pre-gitmodules.txt`.
  - WHY: The submodule override is the canonical Tier-1 customization; if the rebase dropped it, the fork breaks.

  **Acceptance Criteria**:
  - QA Scenario (happy): pin correct on fork/local, absent on dev
    ```
    Tool: Bash
    Steps:
      1. git checkout fork/local
      2. git config -f .gitmodules --get submodule.packages/lsp-tools-mcp.url   (rustybret)
      3. git config -f .gitmodules --get submodule.packages/lsp-tools-mcp.branch   (local/enhancements)
      4. git checkout dev; git config -f .gitmodules --get submodule.packages/lsp-tools-mcp.url   (NOT rustybret / or absent)
    Expected Result: override on fork/local, not on dev
    Evidence: .omo/evidence/task-10-submodule.txt
    ```
  - Evidence: .omo/evidence/task-10-submodule.txt

  **Commit**: NO (verification; any fix folds into Task 7 reconstruction)

- [x] 11. Rewrite fork-maintenance-guide.md for the two-branch model

  **What to do**:
  - Rewrite `docs/guide/fork-maintenance-guide.md` from the single-`main` merge model to the two-branch rebase model: `dev` (clean FF mirror) + `fork/local` (customization layer).
  - Standardize cross-fork naming + command syntax (identical to opencode; only repo/upstream names swap). Include: remote setup, sync command (`gh workflow run "Sync Upstream" -f upstream_branch=dev`), local build dispatch, conflict-resolution-via-issue flow, and the **rollback runbook** (restore main from backup branch + `gh repo edit --default-branch main`).
  - Embed the Task 5 workflow fate table and the pre-commit hook install (Task 13).
  - Update the "Agent Instructions" block so agents replicate the two-branch SOP on other forks.

  **Must NOT do**: Do not leave any single-main/merge-strategy instructions. Do not document plain `--force`.

  **Recommended Agent Profile**:
  - **Category**: `writing` — Reason: documentation rewrite, prose-heavy.
  - **Skills**: [] — technical writing.

  **Parallelization**: Can Run In Parallel: YES | Wave 3 | Blocks: 14 | Blocked By: 7

  **References**:
  - Pattern: current `docs/guide/fork-maintenance-guide.md` (structure to keep) + opencode live workflows (new semantics) + `docs/reference/opencode-fork-customizations-roadmap.md` (migration narrative).
  - WHY: The guide is the cross-team SOP; it must teach the model that actually shipped.

  **Acceptance Criteria**:
  - QA Scenario (happy): guide reflects two-branch model
    ```
    Tool: Bash
    Steps:
      1. grep -E "fork/local" docs/guide/fork-maintenance-guide.md
      2. grep -E "force-with-lease" docs/guide/fork-maintenance-guide.md
      3. grep -E "[Rr]ollback" docs/guide/fork-maintenance-guide.md
      4. assert NO "merge strategy" / "single main" stale language:  ! grep -iE "merge strategy|single.main"
    Expected Result: two-branch SOP + rollback present; no stale merge/single-main language
    Evidence: .omo/evidence/task-11-guide.txt
    ```
  - QA Scenario (negative): `grep -n "git push --force " docs/guide/fork-maintenance-guide.md` (plain force) returns nothing.
  - Evidence: .omo/evidence/task-11-guide.txt

  **Commit**: YES — `docs(fork): rewrite maintenance guide for two-branch model`

- [x] 12. Update .github/fork-templates/* to the live rebase pattern

  **What to do**:
  - Update `.github/fork-templates/sync-upstream.yml` to the rebase two-branch template (placeholderized: `UPSTREAM_REPO_URL`, `UPSTREAM_BRANCH`, repo names) matching Task 8's live file.
  - Update `.github/fork-templates/ci-private-fork.yml` to target `fork/local` (not main).
  - Verify `.github/fork-templates/local-build.yml` still matches (repository_dispatch).
  - These templates make agent-harness the canonical template source (opencode's own templates are stale).

  **Must NOT do**: Do not leave merge-strategy/single-main templates. Do not hardcode rustybret-specific names (keep placeholders).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — Reason: templating the live workflow with correct placeholder abstraction.
  - **Skills**: [] — YAML.

  **Parallelization**: Can Run In Parallel: YES | Wave 3 | Blocks: 14 | Blocked By: 7

  **References**:
  - Pattern: Task 8 live sync-upstream.yml + Task 9 ci.yml → genericize.
  - WHY: Other forks copy these templates; they must teach the shipped pattern.

  **Acceptance Criteria**:
  - QA Scenario (happy): templates match live pattern
    ```
    Tool: Bash
    Steps:
      1. actionlint .github/fork-templates/*.yml  (or yaml-lint if actionlint rejects placeholders)
      2. grep -E "rebase" .github/fork-templates/sync-upstream.yml
      3. grep -E "fork/local" .github/fork-templates/ci-private-fork.yml
      4. assert placeholders (UPSTREAM_REPO_URL / UPSTREAM_BRANCH) present
    Expected Result: templates use rebase + fork/local + placeholders; no stale merge pattern
    Evidence: .omo/evidence/task-12-templates.txt
    ```
  - Evidence: .omo/evidence/task-12-templates.txt

  **Commit**: YES — `ci(fork): update fork-templates to live rebase pattern`

- [x] 13. Document and track the pre-commit hook install

  **What to do**:
  - The pre-commit hook (runs `utils/models.sh`, stages `utils/models.json` + `utils/models+variants.json`) lives only in `.git/hooks/pre-commit` (untracked). Add a tracked install path: either a `scripts/install-hooks.sh` that writes the hook, or a tracked `.githooks/pre-commit` + documented `git config core.hooksPath .githooks`.
  - Document the hook + install step in the fork-maintenance guide (Task 11 references this).
  - Ensure `utils/models.sh` is executable and tracked.

  **Must NOT do**: Do not adopt opencode's husky pre-push (different purpose). Do not change what the hook does.

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: small scripted addition + doc line.
  - **Skills**: [] — shell.

  **Parallelization**: Can Run In Parallel: YES | Wave 3 | Blocks: 14 | Blocked By: 7

  **References**:
  - Data: existing `.git/hooks/pre-commit`, `utils/models.sh` (session history: exec-bit was fixed earlier).
  - WHY: Untracked hooks vanish on fresh clone; parity means reproducible setup.

  **Acceptance Criteria**:
  - QA Scenario (happy): hook reproducible
    ```
    Tool: Bash
    Steps:
      1. test -x utils/models.sh
      2. test -f .githooks/pre-commit OR test -f scripts/install-hooks.sh
      3. grep -E "hooksPath|install-hooks|pre-commit" docs/guide/fork-maintenance-guide.md
    Expected Result: tracked hook install exists + documented; models.sh executable
    Evidence: .omo/evidence/task-13-hook.txt
    ```
  - Evidence: .omo/evidence/task-13-hook.txt

  **Commit**: YES — `chore(fork): track and document pre-commit hook install`

- [x] 14. Local build + typecheck regression on fork/local

  **What to do**:
  - On `fork/local` with submodule checked out: `git submodule update --init --recursive`.
  - Run `bun install` (if needed), `bun run typecheck`, `bun run build`.
  - Confirm the build matches the pre-migration baseline (session history: `dist/index.js` ~2.50 MB, 613 modules). Document any pre-existing test failures (the 4 known: 3 scheduleDeferredModelOverride + 1 agent-browser skill) as NOT introduced by this migration.

  **Must NOT do**: Do not fix unrelated/pre-existing test failures. Do not push yet (Task 15).

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: run-and-verify build commands.
  - **Skills**: [] — bun.

  **Parallelization**: NO (gate before push) | Wave 4 | Blocks: 15 | Blocked By: 8,9,10,11,12,13

  **References**:
  - Data: session history build baseline (2.50 MB, 613 modules, typecheck clean).
  - WHY: Proves the reconstructed fork/local is functional BEFORE it becomes the published default.

  **Acceptance Criteria**:
  - QA Scenario (happy): build green
    ```
    Tool: Bash
    Steps:
      1. git submodule update --init --recursive
      2. bun run typecheck
      3. bun run build
      4. ls -la dist/index.js
    Expected Result: typecheck passes; build produces dist/index.js; size ~comparable to baseline
    Evidence: .omo/evidence/task-14-build.txt
    ```
  - QA Scenario (negative): any NEW typecheck/build error (not in the documented pre-existing set) → FAIL, return to Task 7.
  - Evidence: .omo/evidence/task-14-build.txt

  **Commit**: NO

- [x] 15. Push dev + fork/local + backup with --force-with-lease

  **What to do**:
  - Push backup branch first (if not already pushed in Task 2): `git push origin backup/main-pre-migration-{date}`.
  - Push clean dev: if origin/dev is new → `git push origin dev`; if it exists → `git push --force-with-lease=dev:<expected-old-dev-sha> origin dev`.
  - Push fork/local: new → `git push origin fork/local`; existing → `git push --force-with-lease=fork/local:<expected-old-sha> origin fork/local`.
  - Set tracking: `git branch --set-upstream-to=origin/dev dev`, `git branch --set-upstream-to=origin/fork/local fork/local`.
  - Do NOT touch origin/main (left intact as live default until Task 16).

  **Must NOT do**: NEVER plain `git push --force`. Do not delete or move origin/main. Do not push over feature branches.

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: the destructive publish step; must use lease guards with exact SHAs and handle new-vs-existing branch cases.
  - **Skills**: [`git-master`] — safe push semantics.

  **Parallelization**: NO (serial) | Wave 4 | Blocks: 16 | Blocked By: 14

  **References**:
  - Data: Task 1 manifest (expected-old SHAs for lease).
  - Guardrail: Metis force-push safety directive.
  - WHY: This is the point of no easy return; lease guards prevent clobbering concurrent changes.

  **Acceptance Criteria**:
  - QA Scenario (happy): remotes updated safely
    ```
    Tool: Bash
    Steps:
      1. git fetch origin --prune
      2. git diff --exit-code origin/dev upstream/dev; echo $?   (==0)
      3. git merge-base --is-ancestor origin/dev origin/fork/local; echo $?   (==0)
      4. git rev-parse origin/backup/main-pre-migration-{date}   (== old main sha)
      5. git rev-parse origin/main   (still == old main sha, untouched)
    Expected Result: origin/dev mirrors upstream; origin/fork/local descends dev; backup + main intact
    Evidence: .omo/evidence/task-15-push.txt
    ```
  - QA Scenario (negative): if any `--force-with-lease` is rejected (stale lease), STOP and re-record SHAs — do not escalate to plain force.
  - Evidence: .omo/evidence/task-15-push.txt

  **Commit**: NO (push operation)

- [x] 16. Switch GitHub default branch to fork/local + branch protections

  **What to do**:
  - `gh repo edit rustybret/agent-harness --default-branch fork/local`.
  - Add branch protection appropriate to a fork (optional but recommended): protect `dev` against direct pushes except the sync workflow; require CI on `fork/local` PRs. Keep protections light if they impede the sync workflow's force-push to dev.
  - Do NOT remove protection from `main` yet (preserve until acceptance + ≥1 sync).

  **Must NOT do**: Do not delete main. Do not over-protect dev such that the sync workflow can't reset it.

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: gh API settings change.
  - **Skills**: [] — gh CLI.

  **Parallelization**: NO (serial) | Wave 4 | Blocks: 17,18 | Blocked By: 4,15

  **References**:
  - Data: Task 4 preconditions (current default branch recorded).
  - WHY: opencode parity = fork/local is the default working branch.

  **Acceptance Criteria**:
  - QA Scenario (happy): default switched
    ```
    Tool: Bash
    Steps:
      1. gh repo view rustybret/agent-harness --json defaultBranchRef -q '.defaultBranchRef.name'   (== fork/local)
      2. gh api repos/rustybret/agent-harness/branches/main --jq '.name'   (still exists)
    Expected Result: default is fork/local; main still present
    Evidence: .omo/evidence/task-16-default-branch.txt
    ```
  - Evidence: .omo/evidence/task-16-default-branch.txt

  **Commit**: NO (repo setting)

- [x] 17. Manual sync-upstream end-to-end run + log assertions

  **What to do**:
  - Trigger: `gh workflow run "Sync Upstream" --repo rustybret/agent-harness --ref fork/local -f upstream_branch=dev` (input name per Task 8 design).
  - Poll: `gh run list --workflow sync-upstream.yml --limit 1 --json databaseId,status,conclusion`.
  - On completion, fetch logs and assert: dev reset to upstream/dev, fork/local rebased (or no-op "up to date"), conclusion `success`. If a conflict occurs, verify an Issue was opened (the designed path) rather than a broken state.

  **Must NOT do**: Do not manually fix a sync failure by hand-editing branches; if it fails, capture evidence for F-wave.

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: end-to-end workflow validation + log forensics.
  - **Skills**: [] — gh CLI.

  **Parallelization**: NO | Wave 4 | Blocks: F1-F4 | Blocked By: 16

  **References**:
  - Pattern: session history — opencode sync run #26142840223 succeeded; replicate the verification.
  - WHY: Proves the core parity feature (automated upstream sync) actually works on agent-harness.

  **Acceptance Criteria**:
  - QA Scenario (happy): sync green
    ```
    Tool: Bash
    Steps:
      1. gh workflow run "Sync Upstream" --repo rustybret/agent-harness -f upstream_branch=dev
      2. (wait) gh run list --workflow sync-upstream.yml --limit 1 --json status,conclusion
      3. RUN_ID=...; gh run view $RUN_ID --log | grep -E "checkout -B dev upstream/dev|rebase|up to date|success"
    Expected Result: conclusion success; logs show dev reset + fork/local rebase/no-op
    Evidence: .omo/evidence/task-17-sync-run.txt
    ```
  - QA Scenario (negative/conflict path): if rebase conflicts, assert an Issue was created and the run did not leave a partial push.
  - Evidence: .omo/evidence/task-17-sync-run.txt

  **Commit**: NO

- [x] 18. Manual CI run on fork/local + rollback runbook validation

  **What to do**:
  - Trigger CI: `gh workflow run ci.yml --repo rustybret/agent-harness --ref fork/local` (or push a trivial no-op commit if CI is push-triggered).
  - Verify conclusion `success` (or only documented pre-existing failures).
  - Validate the rollback runbook from the guide: dry-check the commands (e.g. confirm `origin/backup/main-pre-migration-{date}` resolves and `gh repo edit --default-branch main` is valid) WITHOUT executing the rollback.

  **Must NOT do**: Do not actually execute rollback. Do not fix unrelated CI failures.

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: CI validation + rollback dry-verification reasoning.
  - **Skills**: [] — gh CLI.

  **Parallelization**: NO | Wave 4 | Blocks: F1-F4 | Blocked By: 16

  **References**:
  - Data: Task 11 rollback runbook, Task 2 backup branch.
  - WHY: Confirms CI runs on the new default and that recovery is genuinely available.

  **Acceptance Criteria**:
  - QA Scenario (happy): CI green + rollback valid
    ```
    Tool: Bash
    Steps:
      1. gh workflow run ci.yml --repo rustybret/agent-harness --ref fork/local
      2. gh run list --workflow ci.yml --limit 1 --json status,conclusion   (success)
      3. git rev-parse origin/backup/main-pre-migration-{date}   (resolves)
      4. gh repo view --json defaultBranchRef   (fork/local; rollback target main exists)
    Expected Result: CI success; rollback anchors valid (not executed)
    Evidence: .omo/evidence/task-18-ci-rollback.txt
    ```
  - QA Scenario (negative): if CI fails with a NEW error tied to the migration, capture for F-wave (do not silently pass).
  - Evidence: .omo/evidence/task-18-ci-rollback.txt

  **Commit**: NO

- [x] 19. UNPLANNED: Add cross-compiled platform binaries to .gitignore (came up during T18)

  **What was done** (after subagent delegation with task_id `ses_17b0a11edffeqJFTEZ0Snd6Ute`):
  - Added `/packages/oh-my-opencode-*/bin/` to `.gitignore` in the "Platform binaries (built, not committed)" section
  - `git status` now clean (no more 11 untracked `oh-my-opencode.js` build artifacts)
  - Verified via `git check-ignore`: `packages/oh-my-opencode-darwin-arm64/bin/oh-my-opencode.js` IS ignored; root `bin/oh-my-opencode.js` is NOT ignored (correct — it's a checked-in source shim)
  - Committed `4c34dd1b5` `chore: gitignore cross-compiled platform binaries`
  - Pushed to `origin/fork/local`

  **Why this came up**: `bun run build:binaries` (run earlier for the standalone darwin-arm64 binary) cross-compiled all 11 platforms and produced ~1GB of compiled `oh-my-opencode.js` files in `packages/oh-my-opencode-*/bin/`. These are build outputs (per the platform package.json `"files": ["bin"]`, they ship on npm) but should never be in git.

  **Acceptance Criteria**:
  - [x] `git status --short` shows no `oh-my-opencode-*` untracked files
  - [x] `git check-ignore` confirms the binaries are ignored via the new pattern
  - [x] Root `bin/oh-my-opencode.js` (source shim) is NOT ignored
  - [x] Pushed to origin/fork/local

  **Commit**: YES (4c34dd1b5)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing. Never check F1-F4 before user okay.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify it exists (read inventory doc, check backup branch SHA, run git mirror assertions). For each "Must NOT Have": search for violations (plain force-push in any script/doc, .gitmodules on dev, deleted main, pruned feature branches, source edits, version/publish changes) — reject with evidence if found. Check evidence files exist in .omo/evidence/.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Workflow/YAML + Git-Topology Quality Review** — `unspecified-high`
  Run `actionlint .github/workflows/*.yml`. Verify sync-upstream.yml uses rebase (not merge), ci.yml targets fork/local, no stray `main` triggers. Re-run topology assertions: dev==upstream/dev, fork/local descends dev, submodule pin correct on fork/local and absent on dev. Review the guide + templates for stale single-main/merge language.
  Output: `actionlint [PASS/FAIL] | Topology [N/N] | Docs drift [CLEAN/N issues] | VERDICT`

- [x] F3. **Real End-to-End QA** — `unspecified-high`
  From clean state, execute every QA scenario from every task. Trigger a fresh `sync-upstream.yml` dispatch and a fresh `ci.yml` run; capture `gh run view --log` evidence. Verify rollback commands are syntactically valid (dry-run / --dry-run where possible). Save to `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Sync run [success] | CI run [success] | Rollback [valid] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read the actual git/file changes (git log/diff, gh api). Verify 1:1 — everything specified was done, nothing beyond scope (no feature-branch pruning, no version/publish/dependency/source changes, no unrelated CI fixes). Confirm `main` still exists and is preserved.
  Output: `Tasks [N/N compliant] | Scope creep [CLEAN/N issues] | main preserved [YES/NO] | VERDICT`

---

## Commit Strategy

> Each task commits to `fork/local` (after it exists) or operates on git refs directly (Wave 1-2). Branch-surgery tasks (6,7,15,16) are git operations, not file commits. Doc/workflow tasks (8-13) commit to fork/local.

| Task | Commit | Message | Pre-commit |
|------|--------|---------|-----------|
| 3 | YES | `docs(fork): add agent-harness customizations forensic inventory` | bun run build (schema) |
| 5 | YES | `docs(fork): add workflow fate decision table` | - |
| 8 | YES | `ci(fork): rewrite sync-upstream to rebase two-branch strategy` | actionlint |
| 9 | YES | `ci(fork): retarget ci.yml to fork/local; apply workflow fate table` | actionlint |
| 11 | YES | `docs(fork): rewrite maintenance guide for two-branch model` | - |
| 12 | YES | `ci(fork): update fork-templates to live rebase pattern` | actionlint |
| 13 | YES | `chore(fork): track and document pre-commit hook install` | - |

## Success Criteria

### Verification Commands
```bash
git fetch origin upstream --prune
git diff --exit-code origin/dev upstream/dev                        # exit 0
git rev-list --count --left-right origin/dev...upstream/dev         # 0	0
git merge-base --is-ancestor origin/dev origin/fork/local; echo $?  # 0
git rev-parse origin/backup/main-pre-migration-*                    # equals recorded old main SHA
gh repo view rustybret/agent-harness --json defaultBranchRef -q '.defaultBranchRef.name'  # fork/local
actionlint .github/workflows/sync-upstream.yml .github/workflows/ci.yml  # no errors
bun run typecheck && bun run build                                  # both pass
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] Sync + CI runs green
- [x] `main` preserved, rollback documented
