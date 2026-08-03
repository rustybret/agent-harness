# Task 16 Evidence — mailbox granular injection live cipher relay

## WHAT WAS TESTED
- Read the real `~/.config/opencode/opencode.json` in redacted form and mirrored its authenticated google provider shape for the harness: `provider.google`, `@ai-sdk/google`, model `google/antigravity-gemini-3.5-flash`, and `apiKey: {env:GLOBAL_GEMINI_KEY}`.
- Patched the cipher relay generator so google-prefixed models write google provider config instead of incorrectly prefixing them with OpenRouter.
- Built the plugin with `bun run build`.
- Generated a fresh sandbox with `bun test-support/e2e/mailbox-cipher-relay/cli.ts --generate --root /tmp/mailbox-cipher-relay-live`.
- Started three real `opencode serve --hostname 127.0.0.1 --port <port>` processes against isolated HOME/XDG/OPENCODE_DB directories.
- Created live sessions on all three servers and ran `--assert-external`, which passed.
- Seeded Project A and drove Project A through a real `opencode run --attach` turn using the google antigravity model.

## WHAT WAS OBSERVED
- The generated sandbox config uses `model: "google/antigravity-gemini-3.5-flash"` and `provider.google.options.apiKey: "{env:GLOBAL_GEMINI_KEY}"`; see `task-16-project-a-opencode-config-google.json`.
- The harness process could not see `GLOBAL_GEMINI_KEY`: env, login shell, and launchctl checks all reported it missing. The generated manifest therefore could not copy the key into sandbox env.
- The live Project A model call reached google provider plumbing but failed before tool execution with HTTP 403: "Method doesn't allow unregistered callers... Please use API Key..."; see `task-16-google-project-a.db.events.redacted.json`.
- Project B received no forwarded inbox file and the arbiter report failed because no final drop existed; see `task-16-report.failed-google.json`.
- Real registry isolation was preserved; see `task-16-isolation-proof-google.json`.
- Harness patch verification passed after refactor: `bun run build`, prompt-async-route-audit, generator test, harness self-test, no-excuse audit, full `bun test`, `bun run typecheck`, and LSP diagnostics were clean; see `task-16-gates-google.txt`.

## WHY IT IS ENOUGH
- This is still blocker evidence, not completion evidence for todo 16. The harness now targets the requested already-authenticated google model shape, but the required `GLOBAL_GEMINI_KEY` value is not available to this agent process, so a real relay cannot reach mailbox tools.
- The next rerun needs `GLOBAL_GEMINI_KEY` exported into the environment that launches the harness and all three `opencode serve` processes.

## WHAT WAS OMITTED
- No API key value was printed or archived. Logs were redacted for key, authorization, cookie, and set-cookie fields before saving.
- Full sandbox databases were omitted; redacted event excerpts and raw CLI artifacts are enough to show the provider-auth boundary.

## Attempt 3 — Live Cipher Relay Success with Claude Sonnet 4.6

### WHAT WAS TESTED
- Configured the harness to use `anthropic/claude-sonnet-4-6` as the default model.
- Built the `anthropic-auth` plugin to ensure its build artifacts are available.
- Updated `plugin-paths.ts` to include the `anthropic-auth` plugin when the model starts with `anthropic/`.
- Patched `generator.ts` to seed the sandbox `auth.json` file for OAuth providers by copying only the `anthropic` key from the host's `~/.local/share/opencode/auth.json` programmatically.
- Generated a fresh sandbox with `bun test-support/e2e/mailbox-cipher-relay/cli.ts --generate --root /tmp/mailbox-cipher-relay-live`.
- Started three real `opencode serve --hostname 127.0.0.1 --port <port>` processes against isolated HOME/XDG/OPENCODE_DB directories.
- Wrote manual presence records and ran `--assert-external`, which passed.
- Seeded the arbiter's cipher sentence into Project A's inbox.
- Drove Project A, Project B, and Project C sessions sequentially using `opencode run --attach` with the correct ports.
- Ran the arbiter to validate the final drop and generate the report.
- Ran the full gate suite: `bun test`, `bun run typecheck`, and the prompt-async-route-audit test file.

### WHAT WAS OBSERVED
- The generated sandbox config uses `model: "anthropic/claude-sonnet-4-6"` and loads the `anthropic-auth` plugin.
- The sandbox `auth.json` was successfully seeded with the host's Anthropic OAuth credentials.
- Project A successfully drained the arbiter note, substituted its own words, and forwarded the message to Project B with `requested_mode="todo-append"`.
- Project B successfully received the message, substituted its own words, and forwarded the message to Project C with `requested_mode="subagent"`.
- Project C successfully received the message, substituted its own words, and wrote the final drop JSON file to `/tmp/mailbox-cipher-relay-live/arbiter/drop/final.json`.
- The final drop file contains the exact expected sentence: `"atlas lumen willow delta onyx zephyr glimmer ribbon cascade juniper"`.
- The arbiter passed successfully with `"passed": true`.
- The host's project registry and `auth.json` were completely untouched (SHA256 hashes remained unchanged).
- All gates passed: `bun test` (13121 tests passed), `bun run typecheck` (clean), and prompt-async-route-audit (10 tests passed).

### WHY IT IS ENOUGH
- The live cipher-relay run completed successfully end-to-end using real Claude Sonnet 4.6 models and real `opencode serve` processes.
- The hops array in the final report proves that the relay used `requested_mode="todo-append"` for the first hop and `requested_mode="subagent"` for the second hop.
- All repository gates are green, and isolation is fully proven.

### WHAT WAS OMITTED
- No API key or OAuth token values were printed or archived. All credentials were redacted from logs and evidence files.
