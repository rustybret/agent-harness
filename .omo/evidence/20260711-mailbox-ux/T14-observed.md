# T14 — What Was Observed

1. **tmux TUI smoke**: The TUI successfully rendered in the tmux session (`T14-1-tui-smoke-and-toast.txt`). The sidebar was not visible due to the absence of the required TUI APIs in the current `opencode` version.
2. **`/project-mailbox` dialog**: The slash command returned "No matching items" in the TUI because the plugin skipped registration due to missing TUI APIs. The programmatic test of `applySelection` (`T14-dialog-diff-new.txt`) successfully appended the grant under `senders.<proj2Id>` while preserving both block and inline comments.
3. **Esc behavior**: The programmatic test confirmed that the state is persisted immediately upon selection.
4. **First-registration toast**: The project registry was successfully created in the sandboxed `HOME` (`registry-after.json`), and the project was registered with `registeredAt` set. The toast itself was not visible due to the absence of the required TUI APIs.
5. **Isolation proof**: The real `opencode.db` session count and `opencode.json` mtime remained identical before and after the sandbox execution (`T14-5-isolation-proof.txt`).
