# Task 5 — Workflow Fate Decision Table

**Generated:** 2026-05-31
**Repo (fork):** `rustybret/agent-harness`
**Upstream:** `code-yeongyu/oh-my-openagent`
**Current default branch:** `main`
**Target fork branch scheme:** `fork/local`
**Scope:** Decision-only. No workflow files were modified in this task. Implementation happens in later tasks (8 = sync-upstream rewrite, 9 = retarget + deactivate).

---

## 1. Summary Table

| # | Workflow | Decision | Method | Implements in |
|---|----------|----------|--------|---------------|
| 1 | `sync-upstream.yml` | **REWRITE** | Replace merge strategy with rebase strategy; fix hardcoded `main` refs | Task 8 |
| 2 | `ci.yml` | **RETARGET** | `push`/`pull_request` branches `main` → `fork/local`; fix `github.ref` auto-commit guard | Task 9 |
| 3 | `local-build.yml` | **KEEP-VERIFY** | `repository_dispatch` only — verified, no changes needed | — |
| 4 | `web-ci.yml` | **KEEP + RETARGET** | Retarget `branches: [master, dev]` → fork/local scheme | Task 9 |
| 5 | `web-deploy.yml` | **KEEP + RETARGET** | Retarget `branches: [master, dev]` → fork/local scheme | Task 9 |
| 6 | `publish.yml` | **KEEP-GATED** | Self-gated via `if: github.repository == 'code-yeongyu/oh-my-openagent'` — verified (with caveats) | — |
| 7 | `publish-platform.yml` | **KEEP-GATED** | `workflow_call` + gated parent — verified (with `workflow_dispatch` caveat) | — |
| 8 | `sisyphus-agent.yml` | **DEACTIVATE** | Option A: add repo guard `if:` to the `agent` job | Task 9 |
| 9 | `cla.yml` | **DEACTIVATE** | Option A: add repo guard `if:` to the `cla` job | Task 9 |
| 10 | `refresh-model-capabilities.yml` | **KEEP** | Already has `if: github.repository == 'code-yeongyu/oh-my-openagent'` — verified | — |
| 11 | `lint-workflows.yml` | **KEEP** | Path-triggered actionlint, useful on fork — keep as-is | — |

**Counts:** REWRITE 1 · RETARGET 1 · KEEP+RETARGET 2 · KEEP-VERIFY 1 · KEEP-GATED 2 · DEACTIVATE 2 · KEEP 2 = **11**

---

## 2. Detailed Sections (workflows needing changes)

### 2.1 `cla.yml` — DEACTIVATE (D2 final)

**Why:** CLA-signing automation for the UPSTREAM project's external contributors. Irrelevant to a private fork. Targets the upstream `signatures/cla.json` on branch `dev` and references `code-yeongyu/oh-my-openagent` CLA docs.

**Triggers (current):**
- `issue_comment: [created]`
- `pull_request_target: [opened, synchronize]`

**Structure:** Single job `cla` (one job, two steps). No existing repo guard.

**Recommended method — Option A (repo guard).** Default preference. Preserves the file body intact for clean upstream merges; the workflow simply never executes on the fork.

Add to the `cla` job (line 16-17 region), immediately after `runs-on`:

```yaml
jobs:
  cla:
    runs-on: ubuntu-latest
    if: github.repository == 'code-yeongyu/oh-my-openagent'
    steps:
      ...
```

**Exact ready-to-implement edit (Task 9):** insert one line after `    runs-on: ubuntu-latest` (current line 17):
```yaml
    if: github.repository == 'code-yeongyu/oh-my-openagent'
```

**Option B (rejected):** Reduce `on:` to `workflow_dispatch` only. Rejected because (a) the CLA workflow has no meaningful manual use on a fork, and (b) editing the `on:` block creates a larger merge surface against upstream than a single added `if:` line.

**Conflicts / risks:**
- `pull_request_target` runs with write tokens. Leaving it un-guarded means any PR opened on the fork would invoke `contributor-assistant/github-action`, attempting to write to `signatures/cla.json` on branch `dev` (which may not exist on the fork) and post CLA comments. The repo guard fully neutralizes this.
- This file is **NOT** in the `sync-upstream.yml` PROTECTED_FILES list, so an upstream sync could overwrite the guard. See section 4 risk note.

---

### 2.2 `sisyphus-agent.yml` — DEACTIVATE (D2 final)

**Why:** The `@sisyphus-dev-ai` @mention AI agent that triages issues/PRs for the upstream community. Depends on upstream-only secrets (`GH_PAT`, `OPENCODE_AUTH_JSON`, `ANTHROPIC_*`) and is scoped to upstream maintainers. Not for a private fork.

**Triggers (current):**
- `workflow_dispatch` (with `prompt` input)
- `issue_comment: [created]`

**Structure:** Single job `agent`. It already has a large `if:` condition (lines 18-23) gating on event type, `@sisyphus-dev-ai` mention, and author association — but **no repository guard**.

**Recommended method — Option A (repo guard).** Default preference. Prepend the repo check to the existing `if:` so it short-circuits on the fork while preserving the rest of the condition for upstream-merge fidelity.

**Exact ready-to-implement edit (Task 9):** change the existing job `if:` (lines 18-23) from:
```yaml
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'issue_comment' &&
       contains(github.event.comment.body || '', '@sisyphus-dev-ai') &&
       (github.event.comment.user.login || '') != 'sisyphus-dev-ai' &&
       contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association || ''))
```
to:
```yaml
    if: >-
      github.repository == 'code-yeongyu/oh-my-openagent' &&
      (github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'issue_comment' &&
       contains(github.event.comment.body || '', '@sisyphus-dev-ai') &&
       (github.event.comment.user.login || '') != 'sisyphus-dev-ai' &&
       contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association || '')))
```
(Wrap the existing OR group in parentheses and AND it with the repo guard. Note the added outer `(` before `github.event_name == 'workflow_dispatch'` and the matching extra `)` at the end.)

**Option B (alternative, also acceptable here):** Reduce `on:` to `workflow_dispatch` only and still add the repo guard. Because this workflow's only useful manual entrypoint is `workflow_dispatch`, removing `issue_comment` would stop the fork from even queuing skipped runs on every comment. However, Option A alone is sufficient (the job is skipped) and keeps a smaller merge diff, so **Option A is the recommendation**. If queued-but-skipped runs on every issue comment are considered noise, layer Option B on top.

**Conflicts / risks:**
- Without the guard, every `issue_comment` on the fork queues a run (it would skip on the author-association/mention check in practice, but a fork OWNER commenting `@sisyphus-dev-ai` WOULD pass the existing `if:` and the job would start, then fail on missing secrets). The repo guard removes this entirely.
- Depends on secrets that do not exist on the fork — would fail loudly even if triggered. Guard makes failure impossible rather than merely likely.
- Same un-protected-by-sync-upstream caveat as `cla.yml` (section 4).

---

### 2.3 `ci.yml` — RETARGET (Task 9)

**Why:** Currently triggers only on `main`. The fork's active development branch under the new scheme is `fork/local`; CI must run there.

**Branch refs to change:**

| Location | Current | Change to |
|----------|---------|-----------|
| `on.push.branches` (line 5) | `[main]` | `[fork/local]` |
| `on.pull_request.branches` (line 7) | `[main]` | `[fork/local]` |
| `build` job → "Auto-commit schema changes" step `if:` (line 114) | `github.event_name == 'push' && github.ref == 'refs/heads/main'` | `github.event_name == 'push' && github.ref == 'refs/heads/fork/local'` |

**Conflicts / risks:**
- The auto-commit-schema step (lines 113-124) does `git push` back to the branch. After retargeting to `fork/local`, confirm `fork/local` is not branch-protected in a way that blocks the `github-actions[bot]` push, or the step will fail. Low risk (it only pushes when `assets/oh-my-opencode.schema.json` differs).
- `ci.yml` **IS** in the `sync-upstream.yml` PROTECTED_FILES list (line 57), so the fork version is preserved across syncs — good. Keep it listed after the rewrite in Task 8.
- Decide whether `fork/local` is the only CI branch or whether PRs targeting it from other fork feature branches also need coverage (current pattern covers pushes to `fork/local` and PRs whose base is `fork/local`).

---

### 2.4 `web-ci.yml` — KEEP + RETARGET (Task 9)

**Why:** Builds the `packages/web/` marketing site (Next.js + OpenNext/Cloudflare). Exists on both fork and upstream. Fork needs it firing on the fork branch scheme, not upstream `master`/`dev`.

**ALL branch refs to update:**

| Location | Current | Change to |
|----------|---------|-----------|
| `on.push.branches` (line 5) | `[master, dev]` | `[fork/local]` |
| `on.pull_request.branches` (line 11) | `[master, dev]` | `[fork/local]` |

**Path filters (lines 6-9, 12-15)** — `packages/web/**`, `docs/**`, `.github/workflows/web-ci.yml` — **no change** (path-based, branch-agnostic).

**Conflicts / risks:**
- No secrets used (build/lint/typecheck only). Safe to run on fork.
- `concurrency.group` uses `github.ref` (line 18) — branch-agnostic, no change.

---

### 2.5 `web-deploy.yml` — KEEP + RETARGET (Task 9)

**Why:** Deploys the web site to Cloudflare Workers. Exists on both fork and upstream. Fork needs deploy triggered from the fork branch (or kept manual-only — see risk).

**ALL branch refs to update:**

| Location | Current | Change to |
|----------|---------|-----------|
| `on.push.branches` (line 11) | `[master, dev]` | `[fork/local]` |

**Other refs:** `workflow_dispatch` (lines 4-9) — branch-agnostic, no change. `concurrency.group: web-deploy-${{ github.ref }}` (line 18) — branch-agnostic, no change. Path filters (lines 12-15) — no change.

**Conflicts / risks (IMPORTANT):**
- **Secrets dependency:** This workflow deploys to Cloudflare using `secrets.CLOUDFLARE_API_TOKEN` + `secrets.CLOUDFLARE_ACCOUNT_ID` and the `web-production` environment pointing at `https://ohmyopenagent.com`. These are **upstream production credentials**. If the fork does NOT have its own Cloudflare secrets, a push to `fork/local` would trigger a deploy step that fails at the `wrangler-action` (no secrets) — noisy but harmless. If the fork DOES inherit/duplicate the secrets, retargeting could deploy fork content to upstream's production site. **Flag for human decision in Task 9.**
- **Recommended safer default:** retarget the branch ref AND consider gating the `deploy` job with `if: github.repository == 'code-yeongyu/oh-my-openagent'` (or removing the `push` trigger and keeping only `workflow_dispatch`) unless the fork explicitly wants to operate its own Cloudflare deployment. This is a deviation flag, not a pre-decided verdict — surface it to the user before implementing.

---

### 2.6 `sync-upstream.yml` — REWRITE (Task 8)

**Why:** Current strategy uses `git merge upstream/<branch> --no-ff` into `main` and pushes to `main`. The fork-parity plan calls for a **rebase** strategy. Full rewrite happens in Task 8; this section documents what the decision table commits to.

**Current behavior (to be replaced):**
- Trigger: weekly cron `0 10 * * 1` + `workflow_dispatch` (choice: `dev` / `master`). (Triggers likely retained.)
- Adds `upstream` remote = `https://github.com/code-yeongyu/oh-my-openagent.git`.
- `git merge "upstream/${BRANCH}" --no-edit --no-ff` into the checked-out default branch.
- Conflict auto-resolution favors fork (`--ours`) for `.gitmodules` and **all** `.github/workflows/*`.
- Pushes clean/resolved merge to `main` (`git push origin main`, line 133).
- Opens a PR for unresolved conflicts.
- Submodule (`packages/lsp-tools-mcp`) handling references fork branch `origin/local/enhancements`.

**Hardcoded `main` / branch refs that must change in the rewrite:**

| Location | Current | Notes |
|----------|---------|-------|
| "Attempt merge" echo (line 44) | `Merging upstream/${BRANCH} into main...` | Cosmetic but should reflect rebase + `fork/local` |
| "Push clean merge to main" step name + `git push origin main` (lines 130, 133) | pushes to `main` | Must push to `fork/local` and use rebase-appropriate push (likely `--force-with-lease` after rebase) |
| Merge command (line 46) | `git merge ... --no-ff` | Replace with rebase strategy |
| Submodule fork branch (line 106) | `origin/local/enhancements` | Confirm correct fork submodule branch under new scheme |

**Conflicts / risks:**
- `sync-upstream.yml` **IS** in its own PROTECTED_FILES list (line 57) — the rewritten version protects itself across future syncs. Keep it listed.
- Rebase strategy on a shared/pushed branch implies force-push. Ensure `fork/local` branch protection (if any) permits force-push by `github-actions[bot]`, or the sync will fail.
- The conflict-resolution block favors fork for ALL workflow files — this is what will preserve the Task 9 deactivation guards and retargets across syncs. **Critical:** `cla.yml` and `sisyphus-agent.yml` guards survive ONLY because of this blanket `.github/workflows/*` `--ours` rule (lines 68-74), not because they are individually listed in PROTECTED_FILES. Verify this blanket rule is retained in the Task 8 rewrite (see section 4).

---

## 3. Verified KEEP / KEEP-GATED workflows (no changes)

### 3.1 `publish.yml` — KEEP-GATED (verified, with caveats)
- **Gate present:** `if: github.repository == 'code-yeongyu/oh-my-openagent'` on `preflight-trust` (line 70) and `publish-main` (line 138). ✅
- **Cascade:** `publish-platform` (line 304) is gated by `needs: publish-main` (skipped on fork → unsatisfied → skipped). `release` (line 314) requires `needs.publish-main.result == 'success'` (skipped ≠ success → skipped). ✅ The actual publish/release path cannot run on the fork.
- **Caveat (non-blocking):** `test` (line 34) and `typecheck` (line 51) jobs are **NOT** repo-gated. On a fork `workflow_dispatch` they would run (wasted minutes) but publish nothing. Acceptable; optionally add the repo guard to skip them too. Not required for safety.
- **Verdict:** Gate intact and correct. No change required.

### 3.2 `publish-platform.yml` — KEEP-GATED (verified, with caveat)
- **Primary entry:** `workflow_call` (line 5) — only invoked by `publish.yml` which is gated. ✅
- **Caveat (FLAG):** It also exposes `workflow_dispatch` (line 14) with NO `if: github.repository == ...` guard on any job. A fork maintainer could manually dispatch it. It would attempt `npm publish --provenance` and **fail** at npm trusted-publisher OIDC exchange (the trusted-publisher mapping is bound to `code-yeongyu/oh-my-openagent` + `publish.yml`), so it cannot actually publish from the fork. Risk is wasted minutes / confusing failure, not a real publish.
- **Recommendation (optional hardening, not in pre-decided scope):** add `if: github.repository == 'code-yeongyu/oh-my-openagent'` to the `build` and `publish` jobs to make the `workflow_dispatch` path a clean no-op on the fork. Surface as a flag; default decision remains KEEP-GATED.
- **Verdict:** Cannot fire independently in a harmful way (OIDC blocks publish). No change strictly required.

### 3.3 `refresh-model-capabilities.yml` — KEEP (verified)
- **Gate present:** `if: github.repository == 'code-yeongyu/oh-my-openagent'` on the `refresh` job (line 15). ✅
- Trigger: weekly cron + `workflow_dispatch`. On fork the job is skipped. No PR created on fork.
- **Verdict:** Already fork-safe. No change.

### 3.4 `local-build.yml` — KEEP-VERIFY (verified)
- Trigger: `repository_dispatch: [local-build]` ONLY (line 4-5). Never fires on push/PR/schedule; only via an explicit API dispatch. No branch refs anywhere.
- No secrets beyond `GITHUB_TOKEN` (contents: write for build artifacts).
- **Verdict:** Needs no changes. Fork-safe as-is.

### 3.5 `lint-workflows.yml` — KEEP (verified)
- Trigger: `push` / `pull_request` filtered to `paths: ['.github/workflows/**']` (lines 4-9). No branch filter — fires on any branch when workflow files change, which is desirable on the fork too.
- Runs `actionlint` only. No secrets, no writes.
- **Verdict:** Useful on the fork (catches YAML/syntax errors in the very workflow edits Task 9 will make). Keep as-is.

---

## 4. Cross-Cutting Risks

1. **Guard survival across upstream syncs (CRITICAL).** The Task 9 deactivation guards added to `cla.yml` and `sisyphus-agent.yml` are NOT individually listed in `sync-upstream.yml` PROTECTED_FILES (line 57 lists only `.gitmodules`, `ci.yml`, `sync-upstream.yml`). They survive ONLY because the blanket conflict rule at lines 68-74 forces `--ours` for every `.github/workflows/*` file on conflict. **Action for Task 8:** preserve that blanket `--ours` rule in the rewrite, OR explicitly add `cla.yml` and `sisyphus-agent.yml` (and `web-ci.yml`, `web-deploy.yml`) to PROTECTED_FILES. If neither holds, a clean (non-conflicting) upstream change to those files could silently re-activate them.

2. **Note on `--ours` and non-conflicting changes.** The `--ours` resolution only triggers on *conflicting* hunks. If upstream modifies a workflow file in a way that does NOT conflict with the fork's guard line, the merge/rebase could take upstream's change cleanly. Explicit PROTECTED_FILES + `git checkout --ours` post-merge (unconditional, not conflict-gated) is the more robust pattern — consider for Task 8.

3. **web-deploy.yml production-credential blast radius.** See section 2.5. Retargeting `push` to `fork/local` while upstream Cloudflare secrets are reachable risks deploying fork content to production, OR (more likely) noisy failures if secrets are absent. Requires explicit human decision before Task 9 implementation.

4. **publish-platform.yml `workflow_dispatch` ungated.** See section 3.2. Mitigated by npm OIDC trusted-publisher binding; flag for optional hardening only.

5. **Branch-protection / force-push for sync-upstream rebase.** See section 2.6. Rebase implies force-push to `fork/local`; ensure bot push permissions.

---

## 5. Implementation Handoff (what each later task must do)

- **Task 8 (sync-upstream rewrite):** merge→rebase; retarget `main`→`fork/local` push; verify/strengthen workflow-file protection (risk #1, #2); confirm submodule fork branch.
- **Task 9 (retarget + deactivate):**
  - `ci.yml`: 3 edits (push branches, PR branches, auto-commit `github.ref` guard).
  - `web-ci.yml`: 2 edits (push branches, PR branches).
  - `web-deploy.yml`: 1 edit (push branches) + decide on deploy-job gating (risk #3).
  - `cla.yml`: add `if: github.repository == 'code-yeongyu/oh-my-openagent'` to `cla` job (1 line after line 17).
  - `sisyphus-agent.yml`: wrap existing `if:` in repo guard (lines 18-23 rewrite per section 2.2).
- **No-op (verified safe):** `local-build.yml`, `lint-workflows.yml`, `publish.yml`, `publish-platform.yml`, `refresh-model-capabilities.yml`.
