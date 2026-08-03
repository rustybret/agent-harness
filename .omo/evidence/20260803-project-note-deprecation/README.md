# Deprecate `project_note`; ungate `project_message` for internal sessions

## What was tested

The two cross-project mailbox send tools were mode-gated mirror images:

- `project_message` **hard-blocked** in internal (plain TUI, portless) sessions, returning
  `{"blocked":true,"reason":"internal session - use project_note"}`.
- `project_note` **hard-blocked** in external (served / `--port`) sessions, returning
  `{"blocked":true,"reason":"external session; use project_message"}`.

A description-only deprecation of `project_note` was therefore not viable: it would have
pointed every TUI caller at a tool that refuses to run in that mode. Unblocking internal
mode on `project_message` is the precondition that makes the deprecation coherent, so both
changes land together.

Change set:

1. Removed the internal-mode gate from `project_message` (`resolveSendMode`,
   `MESSAGE_INTERNAL_GUIDANCE`, and its `modeDetector` dep).
2. Removed the now-symmetrical external-mode gate from `project_note` (`resolveNoteMode`,
   `NOTE_EXTERNAL_GUIDANCE`, and its `modeDetector` dep).
3. Marked `project_note` deprecated in its tool description, routing callers to
   `project_message`; `project_message`'s description now states it works in both modes.
4. Removed the dead `mailboxModeDetector` plumbing from the **tools** path only
   (`create-tools.ts` → `tool-registry.ts` → `tool-registry-mailbox-tools.ts`).
5. Updated `docs/reference/cross-project-mailbox.md` and
   `docs/reference/hooks-and-tools.md` to match.

## What was observed

- `bun run typecheck`: clean (exit 0), all workspace packages.
- `bun test`: 13670 pass / 0 fail.
- `bun run build`: `build: all steps completed`, exit 0.
- `bun run test:codex`: 515 pass / 0 fail, exit 0.
- Mailbox feature suite in isolation: 729 pass / 0 fail across 55 files.

Behavior change pinned by rewritten tests rather than deleted ones:

- `project-message-tool.test.ts` previously asserted internal mode returns
  `blocked:true`. It now asserts the inverse — an internal-mode send **delivers**
  (writes the note, appends the outbox record).
- `project-note-tool.test.ts` lost the two describe blocks that existed only to pin the
  removed external-mode gate (`external-mode blocked`, `unknown-mode lazy detect`), plus
  the mode-detector scaffolding they required. The remaining guard-parity tests
  (preflight allowlist, intent budget, hop limits, write-failed trace) are untouched and
  still pass.

## Why it is enough

The gate was the only mode-dependent behavior in either tool's `execute` path; everything
downstream (preflight allowlist, intent budget, hop count, body cap, outbox append, trace
emission) is mode-agnostic and remains covered by the untouched guard-parity tests. The
full suite plus the Codex compatibility gate exercise both tools through their real
registration path.

Invariant #1999 (single shared `ModeDetector` instance) is preserved: the detector is still
created once in `create-plugin-module.ts` and passed to the **hooks** path, which genuinely
needs it for the presence heartbeat and idle-drain sweep. Only the tools path — which no
longer consults mode at all — lost the dependency. Verified by grep: zero remaining
`modeDetector` references under `send-tool/` and `tool-registry*`.

## What was omitted

No live two-project handoff was driven for this change. Internal-mode delivery reuses the
exact file-drop path that `project_note` already used in production (same
`coordination_notes/` writer, same outbox append), and that path is covered end-to-end by
the existing two-repo integration test. No secrets, tokens, or env dumps are included here.
