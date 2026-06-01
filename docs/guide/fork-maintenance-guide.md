# Fork Maintenance Guide: Two-Branch Rebase Model

## Overview

This guide covers how to maintain a private fork of an upstream repository using a **two-branch rebase model**. This is the standard approach used across all forks in this organization.

**The two-branch model:**
- `dev` — pure, byte-for-byte mirror of upstream. Zero customizations. Fast-forward only.
- `fork/local` — your customizations, rebased on top of `dev`. Default branch.

This model keeps upstream history clean and makes conflicts explicit (they show up as rebase conflicts, not merge noise).

## Branch Topology

```
upstream/dev -------------------------------------------> (latest upstream)
                    |  fast-forward only
origin/dev ---------------------------------------------> (pristine mirror)
                    |  rebased on top of dev
origin/fork/local ---● --- ● --- ● --- ● --- ● --------> (your changes)
```

**Rules:**
- `dev` NEVER has fork-specific commits. If it does, the model is broken.
- `fork/local` is ALWAYS rebased on `dev`, never merged.
- Rebase with `--force-with-lease` only. Never plain `--force`.
- `main` is preserved as a backup (never deleted until migration is proven stable).

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

### 3. Create clean dev branch (pristine upstream mirror)
```bash
git checkout -B dev upstream/dev
git diff --exit-code dev upstream/dev  # Must return 0
git push origin dev
```

### 4. Create fork/local from dev
```bash
git checkout -b fork/local dev
# Cherry-pick your customizations onto fork/local
# See forensic inventory in docs/reference/ for which commits to pick
git push origin fork/local
```

### 5. Set fork/local as default branch
```bash
gh repo edit --default-branch fork/local
```

### 6. Install fork workflows
Copy `.github/fork-templates/sync-upstream.yml` to `.github/workflows/sync-upstream.yml`.
The template is pre-configured for the two-branch model.

### 7. Set git default to track origin
```bash
gh repo set-default YOUR_USERNAME/REPO_NAME
```

## Daily Operations

### Check current state
```bash
# What branch am I on?
git branch --show-current

# Is dev still a clean upstream mirror?
git diff --exit-code dev upstream/dev

# How many commits is fork/local ahead of dev?
git rev-list --count dev..fork/local

# Is working tree clean?
git status --short
```

### Make changes
Always work on `fork/local`:
```bash
git checkout fork/local
# ... make changes ...
git add -A && git commit -m "feat: my change"
```

### Add a new fork customization
```bash
git checkout fork/local
# ... implement feature ...
git add -A
git commit -m "feat(fork): description of customization"
# Document it in docs/reference/*-fork-customizations-roadmap.md
```

## Sync Operations

### Manual sync (fetch upstream + rebase)
```bash
# 1. Fast-forward dev to latest upstream
git checkout dev
git merge --ff-only upstream/dev
git push origin dev

# 2. Rebase fork/local onto new dev
git checkout fork/local
git rebase dev

# If rebase succeeds:
git push origin fork/local --force-with-lease

# If rebase has conflicts: see Conflict Resolution below
```

### Automated weekly sync (GitHub Actions)
```bash
gh workflow run sync-upstream.yml -f upstream_branch=dev
```

The workflow runs automatically every Monday at 10:00 UTC. You can also trigger manually with the command above.

**What the workflow does:**
1. Fast-forwards `origin/dev` to `upstream/dev`
2. Rebases `origin/fork/local` onto new `dev`
3. Force-pushes `fork/local` with `--force-with-lease`
4. On rebase conflict: opens a PR to `fork/local` for manual resolution

### After a sync: verify
```bash
git fetch origin
git diff --exit-code origin/dev upstream/dev  # Must be 0
git log dev..fork/local --oneline              # Your customizations only
```

## Conflict Resolution

Rebase conflicts happen when upstream changes the same code your fork customizes.

### When GitHub Actions opens a PR
1. Check out the conflict branch:
   ```bash
   git fetch origin
   git checkout fork/local-conflict-YYYY-MM-DD
   ```
2. Rebase onto dev manually:
   ```bash
   git rebase dev
   # Resolve each conflict file:
   # - KEEP your fork's logic where it's intentional
   # - TAKE upstream's version where it's a refactor of shared code
   git add <resolved-file>
   git rebase --continue
   ```
3. Force-push to fork/local:
   ```bash
   git push origin fork/local --force-with-lease
   ```
4. Close the PR (it was just a notification mechanism).

### Manual conflict resolution
Same as above, starting from `git rebase dev` on `fork/local`.

## Rollback

### Rollback fork/local to pre-sync state
```bash
# Backup is at origin/backup/main-pre-migration-YYYYMMDD
git fetch origin
git checkout fork/local
git reset --hard origin/backup/main-pre-migration-YYYYMMDD
git push origin fork/local --force-with-lease
```

### Rollback dev to a specific upstream tag
```bash
git checkout dev
git reset --hard <upstream-tag-or-sha>
git push origin dev --force-with-lease
```

### Full rollback (abandon two-branch model)
```bash
# Restore main as default branch
gh repo edit --default-branch main
# main branch still exists and was never force-pushed
```

## Overwriting Upstream Workflows in a New Fork

When you first fork a repo, GitHub copies all upstream workflows. For private forks not contributing upstream:

1. **Copy the templates** from `.github/fork-templates/` to `.github/workflows/`:
   ```bash
   cp .github/fork-templates/sync-upstream.yml .github/workflows/sync-upstream.yml
   cp .github/fork-templates/ci-private-fork.yml .github/workflows/ci.yml
   cp .github/fork-templates/local-build.yml .github/workflows/local-build.yml
   ```

2. **Disable upstream-specific workflows** (CLA bots, AI triage, publish pipelines):
   ```bash
   # Rename to .disabled (keeps them in git history but GitHub ignores them)
   git mv .github/workflows/cla.yml .github/workflows/cla.yml.disabled
   git mv .github/workflows/sisyphus-agent.yml .github/workflows/sisyphus-agent.yml.disabled
   # Disable upstream publish workflows
   git mv .github/workflows/publish.yml .github/workflows/publish.yml.disabled
   ```

3. **Retarget remaining workflows** to `fork/local`:
   - All `branches: [master, dev, main]` -> `branches: [fork/local]`
   - All `github.ref == 'refs/heads/master'` -> `github.ref == 'refs/heads/fork/local'`

4. **Commit all workflow changes** atomically:
   ```bash
   git add .github/workflows/
   git commit -m "ci(fork): overwrite upstream workflows for private fork"
   ```

## Agent Instructions

When an AI agent is asked to set up or maintain this fork pattern on another repo:

1. **Read this guide end-to-end first** — do not skip sections
2. **Check the forensic inventory** in `docs/reference/*-fork-customizations-roadmap.md`
3. **Create immutable backups before any branch surgery**:
   ```bash
   git bundle create backup-$(date +%Y%m%d).bundle --all
   git push origin main:backup/main-pre-migration-$(date +%Y%m%d)
   ```
4. **Follow exact command syntax** from this guide — do not improvise git commands
5. **Use `--force-with-lease` never `--force`** for all force pushes
6. **Verify at each step** — `git diff --exit-code dev upstream/dev` must return 0 after every dev sync
7. **If GitHub Issues are disabled** on the target repo, use PRs for conflict reporting (check with `gh repo view --json hasIssuesEnabled`)
8. **On conflict during cherry-pick**: use `git checkout --ours FILE` for fork-specific files (utils/, .gitmodules), `git checkout --theirs FILE` for upstream content

## Consistent Naming (All Forks)

| Concept | Name |
|---|---|
| Upstream mirror branch | `dev` |
| Fork customizations branch | `fork/local` |
| Pre-migration backup | `backup/main-pre-migration-YYYYMMDD` |
| Conflict resolution branch | `fork/local-conflict-YYYY-MM-DD` |
| Default branch | `fork/local` |
| Upstream remote | `upstream` |
| Fork remote | `origin` |

These names are consistent across all forks in this organization. Use them exactly.
