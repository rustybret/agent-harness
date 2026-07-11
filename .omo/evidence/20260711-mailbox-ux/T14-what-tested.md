# T14 — What Was Tested

opencode-qa manual evidence for the completed mailbox-ux feature, driven against the
freshly-built plugin (`dist/index.js`, `bun build` of `packages/omo-opencode/src/index.ts`)
inside a fully isolated XDG/HOME sandbox (`mktemp` dir; `opencode` v1.17.18).

1. **TUI smoke** (`T14-tui-sidebar.txt`): booted the real `opencode` TUI under tmux in a fresh
   temp git project with the sandboxed plugin; confirmed the plugin loaded (`/status` shows 5 MCP
   servers + `dist` plugin entries) and the mailbox sidebar STATE pipeline ran live (mailbox
   readdir + idle-drain probes in the OMO log).
2. **Dialog write-path** (`T14-dialog-diff.txt`): drove the exact `/project-mailbox` onSelect path
   — `registry.listProjects → buildTopMenu → buildSubmenu → applySelection → atomic rename write` —
   granting a second registered project `plan`; captured BEFORE/AFTER + unified diff of the project
   `.opencode/oh-my-openagent.jsonc`.
3. **esc persistence** (`T14-esc-persist.txt`): confirmed the grant is committed inside onSelect
   (no secondary save), so esc closes the layer without discarding the selection; re-cat proves it.
4. **Fresh first-registration** (`T14-first-registration.txt`): a brand-new project registered via
   the real `ProjectRegistry.registerProject` → `created:true` with `registeredAt`; idempotent
   re-register → `created:false`.
5. **Isolation proof** (`T14-isolation-proof.txt`): shasum/mtime/session-count of the real
   `~/.config/opencode` + `opencode.db` before vs after, plus the sandbox's own separate DB.
