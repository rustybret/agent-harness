# Mailbox Restart and Explicit Registry QA

Date: 2026-07-13

## What was fixed

1. OpenCode TUI plugin registration now normalizes a local server entry such as `file:///Volumes/Topper2TB/Git/agent-harness/dist/index.js` to the package-root TUI entry `file:///Volumes/Topper2TB/Git/agent-harness`. OpenCode resolves the package's `exports.tui` entry only from the package directory.
2. Cross-project mailbox hooks no longer auto-register the current project. The project registry is explicit-only.

## Real surface driven

A fresh production build was loaded by the real OpenCode binary in a new process with isolated HOME and XDG directories. The run submitted the prompt `Reply with OK`, entered a real session route, and rendered through the repository's xterm.js browser capture harness.

Command shape:

```text
HOME=<isolated> OPENCODE_TEST_HOME=<isolated> XDG_CONFIG_HOME=<isolated> \
XDG_DATA_HOME=<isolated> XDG_STATE_HOME=<isolated> XDG_CACHE_HOME=<isolated> \
OPENCODE_CONFIG_DIR=<isolated>/config/opencode OPENCODE_DISABLE_PROJECT_CONFIG=1 \
opencode --prompt "Reply with OK"
```

The exact terminal artifacts are under `active-session/`:

- `terminal.png`: browser-rendered xterm.js capture.
- `terminal.txt`: normalized terminal cells.
- `terminal-ansi.txt`: raw terminal stream.
- `metadata.json`: dimensions, connector, and process cleanup receipt.

## What was observed

The real session sidebar visibly rendered an expanded mailbox panel:

```text
▼ Mailbox               v4.17.0

In
Unread                         0
Done                           0

Out
Pending                        0
Read                           0
Failed                         0

Projects
No connected projects
```

The TUI geometry check reported 180 expected columns, 180 maximum width, no overflow lines, no border misalignment, and no wide-character drift.

After the prompt, the isolated `.omo/` contained only `presence/` and `runtime/`. No `project-registry.json` was created.

The user's live `~/.config/opencode/tui.json` was repaired without restarting or terminating any live OpenCode process. It now contains exactly one local OmO TUI entry at the package root alongside the existing CortexKit plugins.

## Why this is enough

This covers the original failure boundary rather than only testing helpers: package export resolution on a fresh TUI process, entry into an active OpenCode session, real mailbox rendering, and the post-prompt absence of automatic registry creation. Unit tests separately pin both path normalization and the removed hook call.

## What was omitted

No credentials, auth files, environment dumps, private mailbox contents, or live user registry data were copied into evidence. The QA environment was isolated and removed after capture. The user's existing OpenCode processes were not restarted or killed.
