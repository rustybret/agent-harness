---
name: macos-cua
description: "macOS native desktop automation — screenshots, clicks, typing, key chords, scrolling, and window targeting via CoreGraphics/AX APIs. Load this skill when the task requires driving the user's macOS desktop UI: capturing a screenshot, clicking a UI element, typing text, pressing key chords, scrolling, or automating a sequence of desktop actions. Do NOT load for file reads, CLI commands, or code editing. Triggers: screenshot, click, type text, key chord, desktop automation, macos computer use, GUI automation, drive a macOS app, macOS UI."
mcp:
  macos-cua:
    type: local
    command: ["/opt/homebrew/bin/node", "/Users/brethoffman/Git/macos-cua/packages/mcp/dist/server.js"]
    enabled: true
---

# macos-cua

TypeScript-native macOS desktop automation via CoreGraphics CGEvent, AXUIElement, and ScreenCaptureKit.
No VM, no Python, no helper binary.

## Prerequisites

macOS system permissions — grant once per terminal binary in **System Settings → Privacy & Security**:

- **Screen Recording** — required for screenshots and window discovery
- **Accessibility** — required for click, type, key, scroll, drag
- **Apple Events** — required when using `--target-bundle-id` (System Events lookups)

Verify: call the `check_permissions` MCP tool (injected below after load). Each permission should
return `authorized`. If denied, call `request_permissions` to trigger the system dialog, then
re-check.

## Workflow

After this skill loads, all MCP tools are available via `skill_mcp`. Standard loop:

1. **Get current state** — call the `screenshot` tool. Use `look_at` to interpret the returned image.
2. **Act** — call the appropriate input tool (`click`, `type_text`, `press_keys`, `scroll`, `drag`).
3. **Verify** — take another screenshot and `look_at` to confirm the action landed.
4. **Repeat** until done.

For targeted app control, pass `targetBundleId` or `targetPid` to input tools. If a target is set,
input routes through the remembered window frame; without a target, input goes to the cursor's
current position.

## Key tools (schemas auto-injected below)

| Tool | When to use |
|---|---|
| `screenshot` | Always the first call; also after any action that changes UI |
| `click` / `double_click` | Click a coordinate. Use zoom on the screenshot first for small targets |
| `type_text` | Keyboard text entry |
| `press_keys` | Key chords (`cmd+shift+t`), function keys, arrows, escape, enter |
| `scroll` | Scroll in a direction by amount at a coordinate |
| `drag` | Drag from one coordinate to another |
| `get_windows` | List visible windows; use to find `pid` for `targetPid` |
| `check_permissions` | Diagnose black screenshots or ignored input |

## Screenshot → look_at pattern

`screenshot` writes a PNG to a temp path. Pass that path to `look_at` to interpret the image
in the same turn. Do not base64 it manually.

```
screenshot → { path: "/tmp/macos-cua-1234.png" }
look_at file_path="/tmp/macos-cua-1234.png" goal="identify the target element"
→ act on what you see
```

Coordinate space: macOS **logical points** (not Retina pixels). If coordinates from a previous
screenshot produce missed clicks, take a fresh screenshot — the window may have moved.

## CLI mode (fallback only)

When MCP is unavailable, use `interactive_bash` with `node ~/Git/macos-cua/packages/cli/dist/cli.js`:

```bash
node ~/Git/macos-cua/packages/cli/dist/cli.js screenshot -o /tmp/shot.png
node ~/Git/macos-cua/packages/cli/dist/cli.js click 500 300
node ~/Git/macos-cua/packages/cli/dist/cli.js type "hello world"
node ~/Git/macos-cua/packages/cli/dist/cli.js key cmd -m shift   # cmd+shift
```

Add `--json` to any subcommand for structured output.

## Safety

**Pause before any irreversible UI action** — deleting files in Finder, confirming a system dialog,
submitting a form, making a purchase. Ask for explicit user confirmation first.

## Reference files (load only when needed)

| Reference | Load when... |
|---|---|
| [`references/mcp-config-examples.md`](references/mcp-config-examples.md) | Configuring macos-cua MCP at global or project scope |
| [upstream `installation.md`](../../../../../../../Git/macos-cua/skills/macos-cua/references/installation.md) | First-time setup, building from source, permission walkthrough |
| [upstream `troubleshooting.md`](../../../../../../../Git/macos-cua/skills/macos-cua/references/troubleshooting.md) | Black screenshots, clicks not registering, binary not found |
