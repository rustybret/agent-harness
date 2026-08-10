> **DOCUMENTATION METADATA**
> - **Origin**: Fork-Local (`rustybret/agent-harness`)
> - **Support Status**: Supported (Fork-Specific)
> - **Notes**: Canonical upstream synchronization procedure (`script/fork-sync.sh`).

# Fork Integration & Upstream Sync Workflow

`fork/local` is the internal Git working branch for the `rustybret/agent-harness` repository. It is **NOT** a published npm package or public release branch — upstream releases are published from `code-yeongyu/oh-my-openagent`, while this repository is consumed directly via Git commit pins (e.g. `github:rustybret/agent-harness#<commit-sha>`).

## Canonical Sync Command

Syncing upstream (`code-yeongyu/oh-my-openagent`) into `fork/local` is performed locally or via cluster CI using **a single command**:

```bash
script/fork-sync.sh
```

## What `script/fork-sync.sh` Does:

1. **Fetches** `upstream` (`code-yeongyu/oh-my-openagent`) and `origin` (`rustybret/agent-harness`).
2. **Fast-forwards** `dev` mirror to `upstream/dev`.
3. **Merges** `dev` into `fork/local` (fast-forward if clean, otherwise a real merge commit).
4. **Auto-resolves** standing conflict classes defined in `script/fork-sync-exclusions`:
   - `keep-deleted:` removes unneeded upstream files (e.g. `.github/workflows/*`, `packages/web/*`, `README*.md`).
   - `keep-ours:` retains fork-preferred generated bundles.
5. **Commits** (`--no-verify`) and **pushes** `fork/local` to `origin`.

## Strict Fork Invariants

- **NEVER rebase `fork/local`** (rewriting published Git history is strictly forbidden).
- **NEVER force-push `origin/fork/local`**.
- **NO GitHub Actions sync jobs** (`sync-upstream.yml` was permanently removed; syncs run via `script/fork-sync.sh`).

For detailed architecture and conflict resolution rules, see [`docs/guide/fork-maintenance-guide.md`](docs/guide/fork-maintenance-guide.md).
