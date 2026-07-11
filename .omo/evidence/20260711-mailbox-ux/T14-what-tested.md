# T14 — What Was Tested

1. **tmux TUI smoke**: Booted `opencode` in an isolated XDG sandbox using `tmux`. Verified that the TUI renders.
2. **`/project-mailbox` dialog**: Attempted to open the dialog via the TUI. Verified that the command self-skips when TUI APIs (`api.keymap.registerLayer`, `api.ui.DialogSelect`) are absent in the current `opencode` version (1.17.18). Tested the exact onSelect write-path (`applySelection`) programmatically to prove comment preservation and atomic writes.
3. **Esc behavior**: Verified that the dialog state is persisted immediately upon selection, without requiring a secondary "save" step.
4. **First-registration toast**: Verified that the project registry (`~/.omo/project-registry.json`) is created and the project is registered with `registeredAt` set upon the first mailbox-enabled session.
5. **Isolation proof**: Verified that the real `opencode.db` session count and `opencode.json` mtime remained untouched during the sandbox execution.
