# TUI Solid TS sibling rewrite QA

## What was tested

- Changed `script/build-tui-solid.ts` so every shipped `.ts` and `.tsx` file under `packages/omo-opencode/src/tui-solid/` is passed through `transformSolidSource()` and emitted as `.js`.
- Added a regression assertion in `script/build-tui-solid.test.ts` proving a plain `.ts` source with `import { createSignal } from "solid-js"` emits `opentui:runtime-module:solid-js` in a `.js` output file.
- Rebuilt the production TUI precompile output and re-ran the isolated live tmux click QA against local `dist/`.

## What was observed

- Before fix: `dist/tui-compiled/mailbox-sidebar-model.ts` line 1 was `import { createSignal } from "solid-js"`.
- After fix: `dist/tui-compiled/mailbox-sidebar-model.js` line 1 is `import { createSignal } from "opentui:runtime-module:solid-js";`.
- `dist/tui-compiled/mailbox-sidebar.js` still exports `./mailbox-sidebar-model`; `bun build ./dist/tui-compiled/mailbox-sidebar.js --external 'opentui:runtime-module:*'` bundled both compiled modules successfully, proving the extensionless sibling resolves to the emitted `.js` file.
- Live QA evidence: `.omo/evidence/20260712-tui-solid-ts-rewrite/live-qa-captures/live-qa-summary.txt`.
  - Host DB count stayed `5941 -> 5941`.
  - Log showed `[tui-sidebar] host runtime source {"source":"host-virtual"}`.
  - Log showed `[tui-sidebar] mounted compiled mailbox component {"compiled":true,"order":150}`.
  - Real SGR click target was row `11`, col `164`, delivered with `tmux -L omofixqa send-keys -H`.
  - Badge sequence: `▼ Mailbox` -> `▶ Mailbox` -> `▼ Mailbox` -> `▶ Mailbox`.
  - Prefs sequence: missing collapsed key -> `"collapsed": true` -> `"collapsed": false` -> `"collapsed": true`.

## Commands run

- `bun test script/build-tui-solid.test.ts`
- `bun run script/build-tui-solid.ts`
- `bun build ./dist/tui-compiled/mailbox-sidebar.js --external 'opentui:runtime-module:*' --outdir <tmp>`
- `bun run build`
- `bun test script/build-tui-solid.test.ts packages/omo-opencode/src/tui-solid/*.test.ts`
- `bun run script/qa/smoke-tui-pack-install.ts`
- `bun run typecheck`
- `lsp_diagnostics` on `script/build-tui-solid.ts` and `script/build-tui-solid.test.ts`: clean.

## What was omitted

- No secrets, auth headers, provider credentials, or env dumps were copied.
- The sandbox tempdir was removed and the dedicated `tmux -L omofixqa` server was killed.
