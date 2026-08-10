> **DOCUMENTATION METADATA**
> - **Origin**: Fork-Local (`rustybret/agent-harness`)
> - **Support Status**: Supported (Fork-Specific)
> - **Notes**: Workflow guide for integrating and syncing upstream changes.

# Integration workflow

Trigger an upstream sync (fetch latest upstream/dev → rebase fork/local)

## One-liner from inside ~/Git/agent-harness:

```bash
gh workflow run sync-upstream.yml -f upstream_branch=dev
```

Watch it: 
```bash
gh run watch or gh run list --workflow=sync-upstream.yml --limit=3
```

## What it does:

1. Fast-forwards origin/dev to upstream/dev
2. Rebases fork/local onto the new dev
3. Force-pushes origin/fork/local

If upstream touched .github/workflows/*.yml — the push is blocked by GitHub (GITHUB_TOKEN limitation). It logs a warning and exits clean. You then push manually:

```bash
git fetch upstream && git push origin upstream/dev:dev
```

```bash
git rebase dev && git push origin fork/local --force-with-lease
```

## Trigger a local build (on your Mac Studio self-hosted runner)

```bash
gh repo dispatch local-build
```

This fires local-build.yml via repository_dispatch — requires the self-hosted runner to be active on your Mac Studio. Start it if it's not running:

# In ~/Git/agent-harness, one-time setup:

- Settings → Actions → Runners → Add self-hosted runner, follow the token flow
- Then on Mac Studio:

```bash
~/actions-runner/run.sh
```

- Do both in sequence

```bash
gh workflow run sync-upstream.yml -f upstream_branch=dev && sleep 5 && gh run watch
```

### After sync completes:

```bash
gh repo dispatch local-build
```

### Weekly automatic sync

Runs every Monday at 10:00 UTC — no manual trigger needed. Check the last run:
```bash
gh run list --workflow=sync-upstream.yml --limit=5
```