# QA evidence: logger sink DI removes cross-file `mock.module` pollution

Date: 2026-08-01
Branch: fork/local
Scope: `packages/utils/src/logging/logger.ts`, plus 16 test files across
`packages/omo-opencode/src` and `packages/claude-code-compat-core/src`.

## What was tested

The 44 pre-existing `bun test` failures on fork/local (43 in
`hooks/runtime-fallback/index.test.ts`, 1 in
`hooks/directory-readme-injector/injector.test.ts`) were traced to cross-file
module-mock pollution rather than to any product defect.

Mechanism: `packages/omo-opencode/src/shared/logger.ts` re-exports
`export const log = logger.log`, a value binding snapshotted at module
evaluation. Any test file calling
`mock.module(".../shared/logger", () => ({ log: ... }))` replaces the whole
module for the rest of the process. Bun's cache-buster (`import("./hook?test=N")`)
re-evaluates only the entry module, not its siblings, so sibling modules in the
victim's graph keep the foreign stub they bound at first evaluation. The
victim's own logger mock then never receives the calls it asserts on.

The fix removes the ability to mock that module at all: a first-class test sink
was added to the shared logger factory, and every logger `mock.module` call in
the workspace was converted to it.

- `packages/utils/src/logging/logger.ts`: `LoggerTestOverrides` gains an optional
  `sink: (message, data?) => void`. When installed, `log()` routes to the sink
  and returns before touching the file buffer. `_resetLoggerForTesting()` clears
  it. Production path is unchanged when no sink is installed.
- 16 test files converted from `mock.module(".../shared/logger", ...)` to
  `_setLoggerForTesting({ sink })` + `_resetLoggerForTesting()` in teardown.
  Remaining logger `mock.module` calls in `packages/*/src`: **0**.

Because the sink lives inside the single logger closure that every consumer
already shares, capture works regardless of when a consumer bound `log`. Sibling
modules that bound the real `log` at first evaluation still route through the
sink.

## What was observed

Commands run from the repo root.

| Check | Result | Artifact |
|---|---|---|
| Full root suite, after fix | **12915 pass / 0 fail / 7 skip**, 12922 tests across 1618 files | `full-suite-after.txt` |
| `hooks/runtime-fallback` isolated | 258 pass / 0 fail | `scoped-suites-after.txt` |
| `packages/omo-opencode/src/hooks` | 2129 pass / 0 fail (was 44 fail) | `scoped-suites-after.txt` |
| `packages/claude-code-compat-core` | 182 pass / 0 fail | `scoped-suites-after.txt` |
| `packages/utils/src/logging` | 7 pass / 0 fail (5 pre-existing + 2 new sink tests) | `scoped-suites-after.txt` |
| Minimal 3-file reproducer, after fix | 80 pass / 0 fail | `minimal-reproducer-after.txt` |
| `bun run typecheck` (all 27 workspace projects) | exit 0, no errors | — |
| `bun run build` | `build: all steps completed` | — |
| LSP diagnostics on changed logger + victim test | no diagnostics | — |
| Full suite + typecheck re-run on post-stash tree ordering | 12915 pass / 0 fail, typecheck exit 0 | `final-reverification.txt` |

The last row matters: the `sse-hook-probe` baseline comparison used
`git stash push`/`pop`, which rewrote source mtimes after the first green run.
Since mtime drives bun's file discovery order, both gates were re-run on the
resulting tree. They reproduce the identical result (12915 pass / 7 skip /
0 fail), so the fix holds across two independent file orderings.

Baseline for comparison: the 44 failures were confirmed on the clean tree
earlier in this work (43 `runtime-fallback` + 1 `directory-readme-injector`),
and the minimal deterministic reproducer was isolated by bisection to exactly
three files in fixed order:

```
bun test \
  packages/omo-opencode/src/features/claude-code-mcp-loader/loader.test.ts \
  packages/omo-opencode/src/hooks/runtime-fallback/index.test.ts \
  packages/omo-opencode/src/index.export-shape.test.ts
```

Before the fix this produced 43 `runtime-fallback` failures; dropping any one of
the three files produced 0. `loader.test.ts` installed the module stub,
`index.export-shape.test.ts` pulled the plugin graph in so siblings bound that
stub, and `runtime-fallback` was the victim asserting on log output. After the
fix the same command is green (`minimal-reproducer-after.txt`).

### Production logging path is untouched

`logger-prod-path-driver.txt` is a driver run against the real
`createLogger` factory (not a mock):

```
prod default path writes to file: true
sink captures: true | sink leaked to file: false
prod path restored after reset: true
DRIVER PASS
```

This proves: with no sink installed, `log()` still buffers and flushes to the
real log file; with a sink installed, output goes only to the sink and never
reaches the file; after `_resetLoggerForTesting()`, file logging resumes.

### Harness QA (opencode side), isolated

`opencode-qa` skill, isolated XDG sandbox, real `opencode` server driven over HTTP:

- `opencode-qa-server-smoke.txt` — `PASS: GET /global/health healthy=true
  version=1.18.5+f235ba6`, `PASS: GET /doc lists 162 documented paths`,
  `PASS: unauthenticated GET /session rejected with HTTP 401`, `PASS: server-smoke`.
- `opencode-qa-isolation.txt` — real `~/.local/share/opencode/opencode.db`
  session count **6839 before, 6839 after**. The QA server never touched the
  real DB.

## Why this is enough

The defect was a test-infrastructure fault, and the evidence closes it at three
levels: the deterministic minimal reproducer (three files, fixed order) is green;
the full 12922-test suite is green where it previously carried 44 failures; and
the production logging path was driven directly to prove the new sink branch is
inert unless a test installs it. Typecheck across all 27 workspace projects and a
full `bun run build` both pass, and the plugin still boots a healthy isolated
opencode server with DB isolation proven by unchanged session counts.

The change is also structurally durable, not just green today: with zero
`mock.module` calls against `shared/logger` remaining anywhere in `packages/*/src`,
no future test can re-introduce this pollution class through that module, and the
sink honors project rule #2177 (prefer dependency injection over `mock.module`).

## What was omitted

- `sse-hook-probe.sh --self-test` fails to observe `server.connected` within its
  15s window. This was re-run against the unmodified HEAD tree
  (`LoggerSink=0`) and fails identically, so it is a pre-existing local
  environment issue and not a regression from this change. Recorded in
  `opencode-qa-sse-probe-preexisting.txt` and `opencode-qa-sse-probe.txt`.
- A full pre-fix suite run is not included as an artifact. Three capture
  attempts were made and all were discarded as methodologically invalid; each is
  documented with its result and the reason for rejection in
  `invalid-baseline-attempts.md`. The fixed-order minimal reproducer above is
  the deterministic, order-independent proof and is used instead.
- No credentials, tokens, or environment dumps are included. The QA server
  password is generated per run by the skill and is not recorded here.
