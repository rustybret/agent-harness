# WHAT WAS TESTED

Replaced the fork's rebase-based upstream sync machinery (which kept reverting
to rebasing and force-pushing, per user report) with a fast-forward-or-merge
model, then proved the new machinery with a REAL live sync against the real
upstream remote.

Change surface (commit 2991c0e25 "fork: canonical merge-based sync tooling"):
- script/fork-sync.sh         new canonical sync (FF mirror, FF-or-merge fork/local,
                              manifest auto-resolution, sweep, push)
- script/fork-sync-exclusions new manifest (keep-deleted + take-theirs globs)
- script/fork-sync-model.test.ts  anti-regression audit (6 tests)
- docs/guide/fork-maintenance-guide.md  rewritten from rebase model to merge model
- AGENTS.md                  sync pointer added
- .github/fork-templates/sync-upstream.yml  deleted (GitHub automation out of policy)

Prior merge resolution (commit 3a9ebdf6d "merge: sync upstream/dev (aa3a16dea)
into fork/local") resolved the standing 10-path conflict set:
- 7x deleted-by-us (upstream workflows + packages/web/{package.json,bun.lock}) -> git rm
- 2x both-modified regenerable senpi bundles (omo.js, omo-member.js) -> checkout --theirs
- 1x both-modified source (packages/omo-opencode/src/config/validate.ts) -> combined
  fork's applyMailboxDefault with upstream's materializeAgentModelChains

# WHAT WAS OBSERVED

1. Merge resolution: 0 unmerged paths after resolution; no conflict markers;
   full `bun run typecheck` exit 0 (tsgo across root + script + all packages).
   Pushed: origin/dev cd4826e1c..aa3a16dea, origin/fork/local 0fd6c7dee..3a9ebdf6d.
2. New audit: `bun test script/fork-sync-model.test.ts` -> 6 pass / 0 fail.
   Script-dir suite baseline vs post-change: 149/37/1 -> 155/37/1 (identical
   pre-existing failures: upstream script tests asserting on .github/workflows/*
   files the fork deleted in c11449af8; none fork-sync related).
3. FIRST script run (script/fork-sync.sh) performed a REAL live sync: upstream
   had moved to fd79bf49b mid-run. Script fetched, fast-forwarded dev
   aa3a16dea..fd79bf49b, pushed origin/dev, detected fork/local divergence,
   created merge commit 2ac90c66c (clean ort merge, no conflicts), pushed
   origin/fork/local 3a9ebdf6d..2ac90c66c. exit=0.
4. Merge 2ac90c66c verified: root AGENTS.md kept fork's version (merge=ours,
   .gitattributes:14), no keep-deleted path resurrected (diff = P1 files +
   upstream's 6 AGENTS.md/test files), upstream's changed tests pass (280/0).
5. SECOND script run: pure no-op ("Already up to date", "fork/local already up
   to date", "Everything up-to-date"), exit=0, `git status --porcelain` empty.
   Idempotency proven.
6. Anti-regression: the audit fails if `git rebase` / `git pull` / --force
   variants / `reset --hard` reappear in script, runbook code fences, or
   workflow templates; and if the manifest loses a standing exclusion glob.

Artifacts:
- .omo/evidence/20260807-fork-sync-model/merge-resolution.txt   (P0 conflict set + resolution)
- .omo/evidence/20260807-fork-sync-model/fork-sync-first-run.txt (real sync run)
- .omo/evidence/20260807-fork-sync-model/fork-sync-idempotent-run.txt (no-op run)
- .omo/evidence/20260807-fork-sync-model/audit-test.txt         (6 pass)
- .omo/evidence/20260807-fork-sync-model/baseline-script-tests.txt (pre-existing 37 fails)
- .omo/evidence/20260807-fork-sync-model/sync-model-verification.txt (merge=ours + diff + 280 pass)

# WHY IT IS ENOUGH

The failure mode being prevented is the sync machinery regressing to
rebase/force-push and re-conflicting on fork deletions. The evidence covers
that on both axes: (a) the current standing conflict set was resolved and the
merge pushed (3a9ebdf6d + 2ac90c66c), and (b) the new tooling was exercised
against the REAL upstream remote twice (one live sync, one idempotent no-op),
plus a CI-style audit that will fail the suite if the rebase machinery or the
deletion-manifest gaps return. No mocked remotes, no dry-runs.

# WHAT WAS OMITTED

- Dependabot vulnerability notice printed by GitHub on push (9 vulns, 4 high)
  is unrelated to this change; not investigated here.
- The 37 pre-existing script-test failures (upstream tests referencing deleted
  .github/workflows files) are out of scope; a follow-up cleanup should decide
  whether to delete or adapt those upstream tests.
- utils/models.json regeneration was skipped for these commits (--no-verify
  per the documented .githooks pre-commit contamination; model cache unchanged).
