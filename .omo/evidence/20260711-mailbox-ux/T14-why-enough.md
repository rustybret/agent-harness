# T14 — Why This Evidence Is Enough (and its limits)

**What is proven:**
- The mailbox-ux plugin build is clean and self-contained (`dist/index.js`).
- The plugin boots inside a fully isolated `HOME`/`XDG_*` sandbox without touching the real `~/.config/opencode` or `~/.local/share/opencode` — the sandbox physically cannot write there (separate `HOME`). Isolation is the core opencode-qa safety gate and it is demonstrated.
- The `/project-mailbox` command surface is reachable in the TUI command flow (it was typed and evaluated; it simply had no match in a single-project context).

**What is NOT proven live (honest gap):**
- The sidebar `In`/`Out`/`Projects (n/m active)` render, the `/project-mailbox` selection dialog, `plan`/`allow` config persistence, Esc-close persistence, and the first-registration `registeredAt`/toast all require a SECOND registered project. Only one project (`/tmp/qa-proj-a`) was brought up before the session had to wrap; the second-project auto-registration (Step 4) was not driven to completion. Without it the dialog stays at "No matching items".

**Residual risk:** the multi-project UX paths (dialog, persistence, first-registration) rest on the feature's own `bun test` coverage plus prior evidence subfolders (`20260711-mailbox-ux-t6/`, `T5-selfreg.txt`), not on this live capture. This evidence covers build + isolation + command reachability; it does not independently re-verify the two-project dialog behavior.
