# Fork Maintenance Guide: Fast-Forward-or-Merge Model

> This fork (rustybret/agent-harness) maintains upstream (code-yeongyu/oh-my-openagent)
> with a **merge-only** sync model. **NEVER rebase. NEVER force-push.** Rebasing and
> force-pushing rewrite published history, destroy the fork's own commits, and are the
> single recurring source of sync confusion in this repo. The canonical sync procedure
> is one command: `script/fork-sync.sh`. Everything below documents what that script
> does and how to handle the cases it leaves for review.

## Overview

The fork keeps two permanent branches:

| Branch | Role | Sync rule |
|--------|------|-----------|
| `dev` | Pristine upstream mirror. **No fork commits ever.** | Fast-forward only: `git merge --ff-only upstream/dev` |
| `fork/local` | The fork's working branch: upstream code + fork customizations + tracked `.omo/` state | Fast-forward when possible, otherwise a **merge commit** |

Sync procedure (identical to `script/fork-sync.sh`):

```
upstream/dev  ──ff-only──▶  dev (mirror)  ──ff-or-merge──▶  fork/local
```

- `dev` is always exactly upstream `dev` (diff must be empty).
- `fork/local` is `dev` plus the fork's own commits. Syncing moves `dev`'s new
  commits in: if `fork/local` has no commits `dev` lacks, git fast-forwards; if
  both sides have diverged, git creates a merge commit.
- Fork deletions and regenerable bundles are re-applied automatically via the
  exclusion manifest (`script/fork-sync-exclusions`), see Conflict Resolution.
- **No GitHub-hosted automation.** The fork runs no GitHub Actions workflows;
  sync runs locally or in the fork's own CI tooling (cloudhome). The old
  `.github/fork-templates/sync-upstream.yml` (a rebase + force-push workflow)
  has been deleted and must not be restored.

## Branch Topology

```
              upstream/dev (code-yeongyu)
                   │
                   ▼  git fetch upstream
origin/dev  ──  dev            (mirror, ff-only updates)
                   │
                   ▼  git merge --ff-only dev  (else: merge commit)
origin/fork/local ──  fork/local (fork customizations)
```

`main` is not used for sync work; it exists as a historical snapshot
(see Rollback).

## Hard Rules

1. **Never rebase** any branch that has been pushed. Never `git pull --rebase`.
2. **Never force-push** (`--force`, `--force-with-lease`). If a push is
   rejected, the remote moved: fetch, then merge or fast-forward again. A
   rejected push is never resolved by rewriting history.
3. **`dev` carries no fork commits.** Its update is always `git merge --ff-only`.
4. **Every divergent sync lands as a merge commit**, never a rebase.
5. **The only sanctioned sync path is `script/fork-sync.sh`** (or the manual
   equivalent in Sync Operations). `script/fork-sync-model.test.ts` fails the
   test suite if rebase or force-push wording reappears in the script, this
   guide, or the fork templates.
6. Commits use `--no-verify`: the `.githooks/pre-commit` hook regenerates
   `utils/models.json` on every commit and would contaminate sync commits.
   Land the regenerated model cache as its own separate commit when wanted.
7. The fork runs **no GitHub Actions jobs**. Do not install workflows, do not
   re-add `sync-upstream.yml`, do not route sync through GitHub services.
   CI/automation belongs to cloudhome tooling.

## Initial Setup (New Fork)

### 1. Fork the repo on GitHub, then clone your fork

```bash
git clone https://github.com/YOUR_USERNAME/REPO_NAME.git
cd REPO_NAME
gh repo set-default YOUR_USERNAME/REPO_NAME
```

### 2. Add upstream remote

```bash
git remote add upstream https://github.com/UPSTREAM_ORG/REPO_NAME.git
git fetch upstream
```

### 3. Create clean `dev` branch (pristine upstream mirror)

```bash
git checkout -B dev upstream/dev
git diff --exit-code dev upstream/dev  # Must return 0
git push origin dev
```

From then on, `dev` is only ever fast-forwarded.

### 4. Create `fork/local` from `dev`

```bash
git checkout -b fork/local dev
# Apply the fork's customizations (commits, .gitattributes merge=ours entries,
# script/fork-sync-exclusions). See the forensic inventory in docs/reference/
# for which commits to pick.
git push origin fork/local
```

Fork-owned files that must survive every merge are protected by
`.gitattributes` `merge=ours` (e.g. AGENTS.md) or by
`script/fork-sync-exclusions` (deleted paths and take-theirs bundles). See
Conflict Resolution.

### 5. Set `fork/local` as default branch

```bash
gh repo edit --default-branch fork/local
```

## Daily Operations

### Check current state

```bash
git branch --show-current                      # what branch am I on?
git diff --exit-code dev upstream/dev          # is dev still a clean mirror?
git rev-list --count dev..fork/local           # how many fork commits ahead?
git status --porcelain                         # is working tree clean?
```

### Make changes

Always work on `fork/local`. This fork does not use PRs for its own changes;
commit directly with `--no-verify` (hard rule 6) and push `fork/local`.

```bash
git checkout fork/local
# ... make changes ...
git add -A && git commit --no-verify -m "feat(fork): description of change"
```

### Add a new fork customization

1. Implement it on `fork/local`, commit, push.
2. If it replaces/removes an upstream file, decide its conflict class:
   - Fork keeps its version → add a `.gitattributes` `merge=ours` entry.
   - Fork deletes the file → add a `keep-deleted:` glob to
     `script/fork-sync-exclusions`.
   - File is a regenerable build artifact → add a `take-theirs:` glob.
3. Document it in `docs/reference/*-fork-customizations-roadmap.md` if it is a
   tracked customization.

## Sync Operations

### Primary: one command

```bash
script/fork-sync.sh                    # fetch upstream, ff dev, merge fork/local, push both
FORK_SYNC_NO_PUSH=1 script/fork-sync.sh   # review mode: no pushes
```

The script:

1. Guards: refuses to run during a rebase or with a dirty tree.
2. `git fetch upstream origin`
3. `git checkout dev && git merge --ff-only upstream/dev && git push origin dev`
4. `git checkout fork/local`; `git merge --ff-only dev`; if that fails
   (divergence), `git merge --no-edit dev`.
5. Auto-resolves the manifest conflict classes (below); if conflicts remain
   that the manifest does not cover, it prints them and exits 1.
6. Sweeps any **new** upstream files matching `keep-deleted` globs out of the
   merge result (amend), then pushes `fork/local`.

### Manual equivalent

```bash
git fetch upstream origin
git checkout dev && git merge --ff-only upstream/dev && git push origin dev
git checkout fork/local
git merge --ff-only dev || git merge --no-edit dev
# resolve any conflicts per Conflict Resolution
git commit --no-verify    # only if a merge left unmerged paths
git push origin fork/local
```

### After a sync: verify

```bash
git diff --exit-code dev upstream/dev      # mirror is still pristine
git log --oneline --first-parent -3         # sync commit(s) visible
git status --porcelain                      # tree clean
```

## Conflict Resolution

Every sync re-raises the same small set of conflict classes. The manifest
`script/fork-sync-exclusions` makes all of them deterministic except the
"combine" class:

| Conflict class | Manifest entry | Auto-resolution |
|---|---|---|
| Deleted by us, modified by them (fork removed an upstream ops file) | `keep-deleted:` glob | `git rm` — the deletion wins; upstream changes are discarded |
| Both modified, regenerable bundle (senpi `omo.js` / `omo-member.js`) | `take-theirs:` glob | `git checkout --theirs` — upstream's build wins; rebuild locally if the fork ever changes the producing sources |
| Both modified, real source file both sides changed (e.g. `validate.ts`) | none | **Manual: combine both changes** |

### The combine class (real source conflicts)

These are few and usually non-overlapping. Example from the 2026-08-07 sync:
upstream added `materializeAgentModelChains()` in `validate.ts` while the fork
added `applyMailboxDefault()`; both belong in the final file:

```ts
const config = applyMailboxDefault(applyDisabledProviders(materializeAgentModelChains(
  protectUserFields(mergeViews(views), userConfig),
)))
```

Rules for combining:

- Read both sides of the conflict; if the logic is independent, keep both.
- If the fork's change and upstream's change touch the same behavior, prefer
  upstream's implementation and re-apply the fork's intent on top of it.
- Never drop a fork feature silently; if a fork change is truly obsolete,
  remove it deliberately and note it in the merge commit message.

### When the script leaves conflicts

1. Resolve each file by hand (combine, or choose the correct side).
2. `git add <resolved-files>`
3. `git commit --no-verify -m "merge: sync upstream/dev (<sha>) into fork/local"`
4. `git push origin fork/local`

## Rollback

Rollbacks never rewrite published history; they add commits.

### Rollback `fork/local` to pre-sync state

```bash
git checkout fork/local
git revert -m 1 <merge-commit-sha>     # undo a bad sync merge
git push origin fork/local
```

Backups of earlier fork states exist as `backup/*` branches
(e.g. `backup/fork-local-pre-merge`) — inspect with
`git log --oneline backup/fork-local-pre-merge -5`, never force-push over them.

### Rollback `dev` to a specific upstream tag

`dev` is a mirror; if it accidentally moved, restore it from upstream:

```bash
git checkout dev
git fetch upstream --tags
git branch -m dev dev-broken            # keep the broken state for inspection
git branch dev upstream/dev
git push origin dev                     # mirror recreation is the sole sanctioned
                                        # force-push in this repo (see prose below)
```

Force-pushing `dev` (the mirror) is the single sanctioned exception: the
mirror carries no fork history and is recreated from upstream in seconds.
`fork/local` is never force-pushed.

### Full rollback (abandon the model)

Snapshot both branches first (`git branch backup/<name> <ref>` for every
branch being replaced), then recreate from upstream per the steps above.
Never `git reset --hard` on a pushed branch and force-push the result.

## Overwriting Upstream Workflows in a New Fork

Not applicable to this fork. The fork deletes upstream's `.github/workflows/*`,
`.github/FUNDING.yml` and `.github/scripts/*` via `script/fork-sync-exclusions`
and runs **no** GitHub Actions jobs. `keep-deleted: .github/workflows/*` makes
any upstream workflow restoration (including brand-new ones) resolve to
deletion on every sync.

## Agent Instructions

These rules are binding for any agent operating in this repository:

1. **Read this guide end-to-end first** — do not skip sections.
2. **Check the forensic inventory** in `docs/reference/*-fork-customizations-roadmap.md`.
3. **Syncs use `script/fork-sync.sh` only.** Never invent a sync by rebasing.
4. **Never run `git pull`** (it may rebase). Use `git fetch` + `git merge --ff-only`.
5. **Never pass `--force`, `--force-with-lease`, or `--rebase`** to any git
   command on `fork/local`.
6. **Never restore `.github/fork-templates/sync-upstream.yml`** or install any
   GitHub Actions workflow; the fork runs no GitHub-hosted jobs.
7. **Verify at each step** — `git diff --exit-code dev upstream/dev` must
   return 0 after every dev sync.
8. **When a sync raises conflicts**, classify them against
   `script/fork-sync-exclusions` first; only the "combine" class needs manual
   work.
9. **Commit with `--no-verify`**; the pre-commit hook regenerates model-cache
   files and would contaminate scoped commits.
10. **Keep `script/fork-sync-model.test.ts` green**; it enforces the
    no-rebase/no-force-push invariant across the script, this guide, and the
    fork templates. Extend it when new automation surfaces.

## Consistent Naming (All Forks)

| Concept | Name |
|---|---|
| Upstream mirror branch | `dev` |
| Fork customizations branch | `fork/local` |
| Pre-migration backup | `backup/main-pre-migration-YYYYMMDD` |
| Sync script | `script/fork-sync.sh` |
| Exclusion manifest | `script/fork-sync-exclusions` |
| Sync model audit test | `script/fork-sync-model.test.ts` |
| Default branch | `fork/local` |
| Upstream remote | `upstream` |
| Fork remote | `origin` |

These names are consistent across all forks in this organization. Use them exactly.
