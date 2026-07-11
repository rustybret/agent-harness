# T14 — What Was Tested

opencode-qa manual evidence for the mailbox-ux feature (branch `feat/project-mailbox-ux`, HEAD `a1df8ca2a`).

- **Build**: OpenCode plugin bundled standalone (`bun build packages/omo-opencode/src/index.ts --outdir dist --target=node --format=esm --external zod`) → `dist/index.js` (5.54 MB). Full `bun run build` avoided (breaks on unrelated omo-codex).
- **Isolation**: fresh `mktemp -d` sandbox with `HOME` + all `XDG_*` redirected under it; `opencode.json` pointing at the built `dist/index.js`; `oh-my-openagent.jsonc` with `cross_project_mailbox.enabled=true`, `default_sender_access=allow-all`.
- **TUI smoke** (`tmux`, 200x50): launched sandboxed opencode against `/tmp/qa-proj-a`, captured the booted render → `T14-tui-sidebar.txt`.
- **Mailbox dialog**: sent `/project-mailbox` in the TUI, captured result → `T14-dialog-diff.txt`.
- **Isolation proof**: real `~/.config/opencode` + `~/.local/share/opencode/opencode.db` compared before/after via macOS `stat` (mtime+size) → `T14-isolation-proof.txt`.

Raw files: `T14-tui-sidebar.txt`, `T14-dialog-diff.txt`, `T14-isolation-proof.txt`, `T14-first-registration.txt`, `T14-esc-persist.txt`.
