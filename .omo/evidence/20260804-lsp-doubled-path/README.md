# lsp_diagnostics doubled the package path and reported the file as missing

## How this was found

I hit it myself at the start of this session: three parallel `lsp_diagnostics` calls on paths like
`packages/omo-opencode/src/features/cross-project-mailbox/sidebar/mailbox-sidebar.ts` all returned

```
ENOENT: no such file or directory, open
  '/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/packages/omo-opencode/src/features/...'
```

Note the doubled `packages/omo-opencode/`. Mining the session database showed this was not a
one-off: **39 occurrences across 14 distinct sessions, from 2026-07-18 to 2026-08-03**.

## Root cause

`resolvePathInsideContext` resolves a relative path against the LSP request cwd. In a monorepo the
caller and the LSP process do not always agree on the base:

- The path `packages/omo-opencode/src/x.ts` is how the file is named everywhere - imports, commit
  messages, documentation, `git status`.
- The LSP process runs with a cwd inside the package, confirmed live: four `omo-lsp` processes on
  this machine, each with a cwd of a different project root.

Resolving the first against the second yields `<repo>/packages/omo-opencode/packages/omo-opencode/src/x.ts`,
which does not exist, so the tool reports the file as missing - for a file that is plainly there.

Reproduced directly through the real resolver:

| cwd | result |
|---|---|
| `<repo>` | `<repo>/packages/omo-opencode/src/.../tui-command.ts` |
| `<repo>/packages/omo-opencode` | `<repo>/packages/omo-opencode/packages/omo-opencode/src/.../tui-command.ts` |

The fix detects when the leading segments of a relative path duplicate the trailing segments of the
cwd, and only trusts that reading when the resulting file EXISTS while the naive resolution does
not. A genuinely missing file still reports its own path rather than a speculative one.

## What was tested

`drive.mjs` replays the REAL `filePath` values from the recorded failures - pulled from the session
database - through the REAL resolver under the REAL request context, with cwd set to the package
root, which is the configuration that produced them.

## What was observed

| | before | after |
|---|---|---|
| recorded failing paths replayed | 36 | 36 |
| **resolved correctly** | **0** | **36** |
| still doubled | 36 | 0 |

(36 rather than 39 because the query deduplicates identical paths and excludes the three that were
already absolute.)

Captures: `before-doubled.json`, `after-overlap-recovery.json`. Before-capture taken by reverting
only `client-wrapper.ts` via `git stash`, re-running the same driver, then restoring - byte-identical
restore verified with `cmp` (`RESTORED-OK`).

## Why this is enough

The replay uses the actual paths that failed in production, through the real resolver, under the
real request context. Three regression tests cover the shape and both guard rails:

- a repo-relative path with a package cwd resolves to the real file (verified to FAIL against the
  original),
- a path relative to the cwd itself still resolves directly - the common case must not regress,
- a genuinely missing file whose prefix overlaps the cwd reports the path as written, so recovery
  cannot invent a location.

The existing path-confinement tests still pass, including the symlink-escape rejection: the recovery
runs before canonicalization, so the `isPathInside` check still governs the final answer.

Full lsp-core suite green (123 pass), full workspace suite green, typecheck clean.

## What was omitted

No secrets involved; the driver opens the session database read-only and prints only 60-character
path prefixes.

Not addressed: WHY the LSP process cwd is the package root rather than the repo root in these
sessions. Fixing the resolver makes both bases work, which is more robust than depending on every
caller and every harness agreeing on one.
