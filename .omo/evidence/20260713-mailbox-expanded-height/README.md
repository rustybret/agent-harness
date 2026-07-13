# Mailbox expanded presentation QA

## What was tested

- Built the production OpenCode plugin and compiled Solid sidebar with `bun run build`.
- Launched the real `/Users/brethoffman/.opencode/bin/opencode` TUI in cmux workspace `mailbox-expanded-height-qa`.
- Isolated the run under `.local-ignore/qa/mailbox-expanded-height/` with dedicated `HOME` and `XDG_*` paths.
- Started a real OpenCode session with `hello, reply only OK` so the host sidebar mounted through the production plugin surface.
- Drove the Mailbox header using real CoreGraphics clicks from `macos-cua`, not injected terminal escape sequences.
- Exercised the sequence collapsed -> expanded -> collapsed.

## What was observed

### Collapsed

`collapsed-presentation.png` shows:

- `▶ Mailbox`
- `in:0 out:0 Projects (1/3 active)`
- Compact panel height with the rest of the sidebar laid out normally.

### Expanded

`expanded-presentation.png` shows:

- The panel grows vertically and displays every `In`, `Out`, and `Projects` row.
- The project heading displays `Projects` and `(1/3)`.
- Offline projects display prefixless ages: `2 days ago` and `1 day ago`.
- The deliberately overlong project label truncates on one line and preserves a visible gap before the right-aligned `online` status.
- No mailbox version string is displayed.

### Recollapsed

`recollapsed-presentation.png` shows the second real click restored the compact summary:

- `▶ Mailbox`
- `in:0 out:0 Projects (1/3 active)`

## Why this is enough

The screenshots prove the behavior through the real host TUI, production plugin bundle, Solid runtime, cmux terminal, and physical macOS click path. The packed runtime probe separately locks the reactive expanded subtree, project count, version absence, single-line truncation, label/status spacing, and bidirectional state transition.

## Automated verification

- Combined focused mailbox, Solid build, packed-smoke, TUI, and sidebar suites: 144 pass, 0 fail across 21 files.
- `bun run typecheck`: passed across root, scripts, and workspace packages.
- `bun run build`: completed all production build steps. The fork's expected missing-upstream warnings were emitted for removed shared-skill submodules and did not fail the build.
- `bun run script/qa/smoke-tui-pack-install.ts`: packed tarball install, compiled TUI shipping, host-runtime virtual imports, bidirectional reactive probe, and raw fallback import all passed.
- Shared TypeScript no-excuse audit: no violations in the six changed source/test files.
- Final Oracle review findings were resolved: fallback project-count color now matches the compiled Solid path when no projects are active, stale `Last seen` fixtures were updated, and the packed probe verifies the existing direct empty-project rendering path.

## Isolation and omissions

- The user's real OpenCode config, project registry, presence records, and live sessions were not modified.
- Fixture registry/config/presence state remained inside the gitignored `.local-ignore/qa/mailbox-expanded-height/` sandbox.
- No credentials, auth files, environment dumps, or secret-bearing logs were captured.
