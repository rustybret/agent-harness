---
name: unity-modal-dismiss
description: "Scoped macos-cua wrapper for OS-level dialog dismissal in Unity. Load this skill when Unity editor modal dialogs, OS-level prompts, or compiler-error Safe Mode dialogs block execution and need to be dismissed. Triggers: dismiss modal, unity dialog, safe mode, compiler error dialog, unity popup, dialog dismissal, dismiss popup."
mcp:
  macos-cua:
    type: local
    command: /opt/homebrew/bin/node
    args:
      - /Users/brethoffman/Git/macos-cua/packages/mcp/dist/server.js
    enabled: true
---

# unity-modal-dismiss

Scoped macos-cua wrapper for OS-level dialog dismissal in Unity.

## When to use

Use this skill when Unity editor modal dialogs, OS-level prompts, or compiler-error Safe Mode dialogs block execution and need to be dismissed.

## Dismissal Priority Order

When a modal dialog or blocking popup is suspected, you MUST follow this exact 3-step priority order:

1. **Bridge Modals**: Call the unitySuperMCP bridge tools `list_pending_modals` and `dismiss_modal` first.
2. **Safe Mode Check**: Call `bridge_safe_mode_check` for compiler-error/Safe-Mode dialogs.
3. **OS-Level Dialogs (macos-cua)**: Use macos-cua `screenshot` and `click` ONLY for OS-level dialogs the bridge cannot see (e.g., version-upgrade wizard, firewall prompt, terms acceptance).

## Scoped Tools Usage

Only the following macos-cua tools are documented and allowed for OS-level dialog dismissal:

- **screenshot**: Capture the current screen state to locate the dialog or button.
- **click**: Click on the coordinates of the button (e.g., "OK", "Dismiss", "Accept") identified in the screenshot.
- **press_keys**: Send key presses (e.g., "enter", "escape") if keyboard navigation is required to dismiss the dialog.

Do NOT use or attempt to call any other tools not listed above.

## Machine-specific

This skill is developer-local and not portable because it uses absolute paths for the local MCP server:
- Node path: `/opt/homebrew/bin/node`
- Server path: `/Users/brethoffman/Git/macos-cua/packages/mcp/dist/server.js`

To run this skill on other machines, these paths must be re-pointed to the local Node binary and macos-cua server build.
