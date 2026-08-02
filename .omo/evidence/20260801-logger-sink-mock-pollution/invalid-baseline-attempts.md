# Why no pre-fix baseline artifact is included

Three attempts to capture a pre-fix baseline were made and all were discarded as
invalid. They are documented here so the omission is auditable.

1. `git stash push` the fix, run `bun test`, `git stash pop`.
   Result: 0 fail. Invalid — stash push/pop rewrites file mtimes, which changes
   bun's test-file discovery order, which changes whether the polluter runs
   before the victim. The stashed run is not the same ordering as HEAD.

2. Same stash approach, but passing an explicit fixed file list (1023 paths).
   Result: 0 fail across 9102 tests. Invalid for the same mtime reason, and the
   explicit list also excludes the non-`omo-opencode` files whose ordering
   participates in the real full-suite run.

3. `git worktree add /tmp/omo-baseline-head HEAD --detach`, symlink node_modules,
   run `bun test`. Result: 103 fail / 68 errors. Invalid — the detached worktree
   lacks the untracked/generated state the suite depends on, so the failures are
   environmental, not the pollution under study.

The deterministic replacement is the fixed-order minimal reproducer described in
README.md, whose file order is fixed by command-line argument and is therefore
immune to mtime-driven reordering. Before the fix it produced 43 failures; after
the fix it produces 0 (`minimal-reproducer-after.txt`).
