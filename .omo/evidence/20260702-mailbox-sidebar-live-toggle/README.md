# QA Evidence: Mailbox sidebar click toggle + live in-session updates

Date: 2026-07-02
Change: `packages/omo-opencode/src/tui.ts` + `packages/omo-opencode/src/features/tui-sidebar/render-view.ts`

## What was tested

Two user-reported defects in the mailbox TUI sidebar:
1. Clicking the `▼ Mailbox` header arrow did not collapse/expand the section.
2. Counts did not update during a session; they only changed after exit + restart.

Root causes:
- The slot renderer registered as `sidebar_content: renderMailbox` returned an
  already-materialized node tree ONCE. opentui's Slot resolves the renderer's
  return through solid's `children()` memo; a plain node tree has no reactive
  reads, so nothing ever re-rendered. `requestRender()` repainted the SAME stale
  tree. Both the toggle click (which mutated a plain `let` boolean) and the
  1s poll (which reassigned a plain `let` view) were invisible to solid.
- The `onMouseDown` handler was attached to the header `text` node, but opentui's
  reconciler ignores event props on TextNodeRenderable children (only `href`
  and `style` are applied to text-node renderables), so the click never bound.

Fixes (mirroring the AFT / Magic Context sidebar pattern):
- `tui.ts`: renderers now return a THUNK (`sidebar_content: () => renderMailbox`)
  so the slot's `children()` memo re-runs on signal changes; sidebar view and
  collapse state moved from plain `let` bindings into host `solid-js`
  `createSignal` pairs (imported at runtime; the OpenCode TUI rewrites the
  `solid-js` specifier to the host runtime module, guaranteeing one shared
  reactive system). `solid-js` added to deps + `--external solid-js` in the
  tui build so the bundle keeps the bare import.
- `render-view.ts`: the toggle `onMouseDown` moved from the header `text` node
  to a full-width header row `box` (BoxRenderable receives mouse listeners),
  matching AFT's clickable header row.

Command: `bun run build`, then launched `opencode -c` in tmux session
`mailbox-toggle-qa` (200x55) in `/Volumes/Topper2TB/Git/agent-harness`, seeded
2 QA notes into `coordination_notes/cloudhome-5aa53d2c/`, and drove clicks by
sending SGR mouse press/release sequences (`\x1b[<0;170;9M` / `m`) at the
Mailbox header cell.

## What was observed

- Initial render: `▼ Mailbox` with `Unread 3` (2 seeded + 1 pre-existing) and
  `Pending 1` under Out.
- Click 1: section collapsed to `▶ Mailbox` + summary `in:3 out:1`
  (capture: tui-collapsed.txt shows the later `in:2 out:1` state).
- Click 2: section expanded back to the full In/Out rows
  (capture: tui-expanded-after-toggle.txt).
- `~/.config/opencode/tui-preferences.jsonc` `oh-my-openagent.mailbox.collapsed`
  flipped with each click (persistence path intact).
- Live update WITHOUT restart: deleted one seeded note on disk; within one poll
  interval the pane showed `Unread 2`. Previously this required a session
  restart.

## Why it is enough

The exact two reported behaviors were driven end-to-end in the real TUI:
mouse toggle (both directions, with pref persistence) and in-session count
refresh (filesystem change reflected in the live pane). Unit coverage:
21 render-view/tui tests pass including the relocated onMouseDown assertions;
full tui-sidebar suite 85 pass; typecheck + full build green.

## What was omitted

QA notes (`qa-toggle-*.md`) were deleted after the run; the pre-existing unread
note from opencode-228cc625 was left untouched. No secrets appear in captures.
Session used the user's real opencode profile (not XDG-sandboxed) because the
test required the real project mailbox state; no writes occurred outside
`coordination_notes/` QA files and `tui-preferences.jsonc` toggles, and the
collapse state was restored to expanded (`collapsed: false`).
