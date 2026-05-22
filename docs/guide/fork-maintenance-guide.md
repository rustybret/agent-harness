# Standard Operating Procedure: Upstream Fork Maintenance

This guide defines the standard setup for maintaining private or customized forks of upstream open-source repositories. 

It is designed for both human engineers and AI agents to execute consistently across any repository.

## 1. Core Conventions

- **Default Local Branch:** Matches the upstream's primary active branch (typically `dev` or `main`). Ensure your local fork's default branch aligns with what the upstream project expects, and that it is configured to track **`origin/<default_branch>`** rather than upstream (to simplify status checks and push/pull behavior).
- **Upstream Tracking Branch:** `upstream/<default_branch>` (The upstream project's default branch, e.g., `upstream/dev` or `upstream/main`). For fetching and rebasing updates only.
- **Submodule Customization Branch:** `local/enhancements` (If a submodule is forked, all custom changes are developed on this branch).
- **GitHub Remote Names:**
  - `origin`: Our private fork (e.g., `https://github.com/rustybret/<repo_name>.git`).
  - `upstream`: The original upstream repository (e.g., `https://github.com/<upstream-org>/<repo_name>.git`).

## 2. Standard Setup Process

When initializing a new fork, execute these steps exactly.

### Step 2.1: Configure Remotes and Defaults
```bash
# Set default GitHub CLI repo to our fork to avoid interactive prompts
gh repo set-default rustybret/<REPO_NAME>

# Add upstream remote
git remote add upstream <UPSTREAM_REPO_URL>
git fetch upstream

# Ensure local default branch tracks origin (our fork) rather than upstream
git branch --set-upstream-to=origin/<default_branch> <default_branch>
```

### Step 2.2: Handle Submodules (If Applicable)
If the upstream project uses submodules and we need to modify them:
1. Fork the submodule on GitHub (`gh repo fork <upstream-org>/<submodule-name> --clone=false`).
2. Point our `.gitmodules` to our fork:
```bash
git config --file=.gitmodules submodule.<submodule-path>.url https://github.com/rustybret/<submodule-name>.git
git submodule sync <submodule-path>
```
3. Checkout the standard local branch inside the submodule:
```bash
cd <submodule-path>
git checkout -b local/enhancements
git push -u origin local/enhancements
```

### Step 2.3: Overwrite Upstream Workflows
Upstream repositories contain workflows for publishing to package registries, creating releases, and blocking PRs. **These must be purged from our private forks** to prevent CI failures and unwanted publishes.

1. Delete existing upstream workflows that are not needed:
```bash
rm -f .github/workflows/publish*.yml
rm -f .github/workflows/release*.yml
```
2. Copy standard templates from the repository's `.github/fork-templates/` directory (creating the directory and copying templates from a reference fork repository if they do not yet exist):
```bash
cp .github/fork-templates/ci-private-fork.yml .github/workflows/ci.yml
cp .github/fork-templates/sync-upstream.yml .github/workflows/sync-upstream.yml
cp .github/fork-templates/local-build.yml .github/workflows/local-build.yml
```
3. Customize the copied templates to match the current repository (e.g., matching build steps in `ci.yml`, replacing `<UPSTREAM_REPO_URL>` in `sync-upstream.yml`, and setting target branches to `dev` or `main` depending on the repository).

## 3. Standard Operations (Command Cheatsheet)

### Triggering an Upstream Sync
```bash
gh workflow run "Sync Upstream" -f upstream_branch=<default_branch>
```

### Triggering a Local Build (via Self-Hosted or Local Dispatch)
```bash
gh repo dispatch local-build
```

### Manually Resolving Sync Conflicts
If the `Sync Upstream` workflow creates a conflict PR:
```bash
gh pr checkout <PR_NUMBER>
# Resolve conflicts in editor
git commit -m "chore: resolve upstream sync conflicts"
gh pr merge <PR_NUMBER> --merge --delete-branch
```

## 4. Agent Instructions

**When an AI agent is tasked with "setting up this fork to match our standard setup":**
1. Read this document.
2. Check `.github/workflows/` and rigorously delete publishing/release artifacts inherited from upstream.
3. Apply the `Sync Upstream` workflow. Ensure the `UPSTREAM_REPO_URL` is hardcoded correctly in the `.yml` file and the target branches are matched to the current repository's default branch.
4. Ensure `.gitmodules` points to `rustybret/` forks if the submodules are customized.
5. Commit with message: `ci: standardize fork configuration and upstream sync`.
