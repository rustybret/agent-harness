# QA Evidence: Mailbox TUI sidebar two-column redesign

Date: 2026-07-01
Change: `packages/omo-opencode/src/features/tui-sidebar/render-view.ts` mailbox rendering rewrite

## What was tested

The mailbox sidebar section was reported as rendering inline rows
(`in 2 unread 0 done` / `out 1 pending 1 read 0 fail`) at the bottom of the
sidebar, instead of the designed two-column layout matching the AFT and
Magic Context sidebar style.

Fix applied:
- Count rows are now `box` nodes with `flexDirection: "row"` and
  `justifyContent: "space-between"` containing two `text` children:
  label (left, muted) and count (right, colorized). Same node pattern as
  Magic Context's `sidebar-content.tsx` StatRow component.
- Group headers `In` / `Out` render as their own rows with `marginTop: 1`.
- Header arrow moved to prefix (`▼ Mailbox` / `▶ Mailbox`) to match the
  Magic Context / MCP header convention.
- Removed the `borderStyle: "single"` wrapper box + padding so the section
  visually matches the flat AFT/Magic Context style.
- Collapsed summary and idle placeholder unindented (no more raw padEnd
  column faking inside a single text node).

Command: launched `opencode` in tmux session `mailbox-qa` (200x55) inside
`/Volumes/Topper2TB/Git/agent-harness` after `bun run build`, loaded the
"Mailbox check" session, captured pane.

## What was observed

`tui-capture.txt` shows the live render:

```
▼ Mailbox
In
Unread                             2
Done                               0

Out
Pending                            1
Read                               1
Failed                             0

  ▼ Magic Context           v0.30.3
```

- Two-column: labels left-aligned, counts right-aligned (space-between).
- Mailbox renders ABOVE Magic Context (slot order 150 < 200) — confirmed
  in the same capture.
- Counts reflect the real seeded state (2 unread inbound from
  cloudhome-5aa53d2c fixtures, outbox JSONL with 1 pending + 1 read).

## Why it is enough

- The full unit suite for tui-sidebar + cross-project-mailbox passes
  (420 tests, 0 fail), including 3 new/updated structural tests asserting
  the space-between row boxes with exactly 2 text children.
- The live TUI capture proves the real host (opencode 1.17.13) renders the
  new node structure correctly through @opentui's flex layout, and the slot
  ordering places the panel above Magic Context.

## What was omitted

- Full-screen screenshot (text pane capture is sufficient to verify column
  alignment; the pane capture preserves exact column positions).
- Mouse-click collapse toggle re-test: the toggle wiring (`onMouseDown` on
  the header) is unchanged from the previously QA'd implementation; only
  the node layout inside the section changed. Unit tests still assert the
  toggle prop is carried on the header text.
