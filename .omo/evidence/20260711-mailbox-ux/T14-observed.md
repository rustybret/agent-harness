# T14 — What Was Observed

- **Build**: `dist/index.js` produced at 5.54 MB, 1951 modules bundled (§4). Plugin loads cleanly.
- **Sandboxed opencode booted live** inside the isolated `HOME`/`XDG_*` temp dir. TUI rendered the OpenCode banner, prompt box, and status line `/private/tmp/qa-proj-a:master  ⊙ 4 MCP` with agent `Sisyphus - Ultraworker` (see `T14-tui-sidebar.txt`). This proves the built plugin initializes in an isolated environment.
- **`/project-mailbox` → "No matching items"** (see `T14-dialog-diff.txt`). The mailbox slash command did not surface in a single-project sandbox. Command palette filtered on `/mailbox` showed only unrelated skill commands, confirming `/project-mailbox` was not selectable.
- **Sandbox registry empty**: `find $QA_HOME -name project-registry.json` returned nothing — no cross-project registry was created for a lone project.
- **Isolation**: sandbox wrote ONLY under the `mktemp` path (`config/opencode/node_modules`, `cache/opencode/skills`, etc.). Real `~/.local/share/opencode/opencode.db` mtime advanced only because this QA runs inside a separate live opencode harness process, which cannot be reached by the sandbox (`HOME` physically differs). See `T14-isolation-proof.txt`.
