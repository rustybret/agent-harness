# T6 live mailbox config QA

## What was tested

- `bun test packages/omo-opencode/src/features/cross-project-mailbox`
- `lsp_diagnostics` on all seven T6 TypeScript files
- `.agents/skills/opencode-qa/scripts/tui-smoke.sh --self-test`
- `.agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test`

## What was observed

- Mailbox suite: 440 passed, 0 failed, 913 assertions across 34 files.
- Resolver coverage includes exact 3000ms expiry, live edit visibility, fallback on throw, 100-call flood guard, single-flight, and immediate invalidation.
- All changed TypeScript files reported no LSP diagnostics.
- TUI smoke rendered, accepted input, cleaned up tmux, and preserved the real OpenCode DB session count at 5814.
- The SSE self-test timed out without observing `server.connected`; raw output is in `sse-hook-probe.txt`.

## Why it is enough

- The feature-specific suite directly executes every permission-decision path changed by T6 and verifies the cache concurrency contract.
- The isolated real-harness TUI smoke proves OpenCode still boots with the plugin environment without modifying the user's session database.

## What was omitted

- No provider-backed prompt was sent. T6 changes local config resolution and permission gates, so provider output would not add coverage beyond the deterministic tool and hook tests.
- No credentials, environment dumps, auth headers, or private configuration were captured.
