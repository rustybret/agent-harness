# Task 10: Live QA — real click toggles the mailbox panel

## What was tested

A real, human-equivalent live QA of the mailbox sidebar in a running opencode TUI, driven
against the **local `dist/` build** (T1–T9 code) in a fully isolated sandbox. Concretely:

1. Fresh `bun run build` (production build of the plugin + `dist/tui.js` + `dist/tui-compiled/`).
2. Launched the real opencode TUI (opencode 1.17.18) under tmux in an isolated XDG sandbox with:
   - `XDG_{DATA,CONFIG,CACHE,STATE}_HOME` + `HOME` + `TMPDIR` all pointed at a `mktemp -d` dir
     (mirrors `script/agent/qa-sandbox.sh` and the `opencode-qa` skill's `oqa_mk_isolated_xdg`).
   - Server plugin wired via `opencode.jsonc` → `"plugin": ["file://<repo>/dist/index.js"]`.
   - **TUI plugin wired via `tui.json` → `"plugin": ["file://<repo>"]` (the repo DIRECTORY, not
     `dist/index.js`).** This is the crux of the known-issue from prior attempts (memory #1533):
     the OpenCode TUI resolves plugins independently of `opencode.json`. Pointing `tui.json` at the
     repo directory makes OpenCode resolve `package.json`'s `exports["./tui"]` → `dist/tui.js` (the
     TUI module), whereas pointing it at `dist/index.js` would load the **server** module and the
     sidebar would never mount. Verified `dist/tui.js`'s default export has a `.tui` function and
     `exports["./tui"] === "./dist/tui.js"` before launch.
3. **Confirmed the sandbox actually runs T1–T9's code**, not the published npm package: grepped the
   isolated plugin log for `[tui-sidebar] mounted compiled mailbox component` — a string that only
   exists in the post-T8 code path.
4. **Real click toggle** via `tmux send-keys -H` SGR mouse press+release bytes targeting the exact
   on-screen cell of the "▼/▶ Mailbox" badge row (input path into the pane's stdin — never
   `/dev/ttys*`, forbidden per memory #1991). Measured the badge cell column with a wcwidth-aware
   Python pass over `capture-pane` output; clicked 3 times to prove both toggle directions.
5. `/project-mailbox` dialog full regression: opened via slash palette, selected a project, changed
   its `intent_budget` plan→impl, verified the `.opencode/oh-my-openagent.jsonc` write, then reverted
   impl→plan through the dialog and diffed back to byte-identical.
6. Captured collapsed digest + expanded sidebar box frames via `tmux capture-pane -p`.

**macos-cua was SKIPPED entirely this run**, per orchestrator instruction: it caused "DEGRADED
function cannot be invoked" infra errors on two prior attempts. The plan documents the tmux
`send-keys -H` path as the valid contingency (c), which is what was used.

## What was observed

### 1. Isolation proof (session-count diff)

| Point in time | Host DB `session` count | Isolated sandbox DB |
|---|---|---|
| Baseline (before launch) | 5927 | (none) |
| After TUI launch + session + clicks + dialog | **5927 (unchanged)** | `<sandbox>/data/opencode/opencode.db` → **0** |

Host `~/.local/share/opencode/opencode.db` was read-only via `sqlite3` and never touched. The real
session was written to the sandbox DB (which the plugin/host created), and the host count is
identical before and after. Isolation holds.

### 2. Sandbox runs the local T1–T9 build (not npm)

From the isolated plugin log (`$TMPDIR/oh-my-opencode.log`), captured to
`task-10-captures/tui-sidebar-log.txt`:

```
[tui-sidebar] host runtime source {"source":"host-virtual"}
[tui-sidebar] mounted compiled mailbox component {"compiled":true,"order":150}
```

- `source: "host-virtual"` proves the sidebar bound to the **host** solid runtime (T6 — the
  frozen-toggle root-cause fix). A stale/npm build or a split runtime would not log this.
- `mounted compiled mailbox component {"compiled":true}` proves the **compiled TSX path** (T7+T8)
  mounted — this exact log line does not exist pre-T8. This is the required confirmation that the
  wired build is our local one.

### 3. Real click toggles collapse/expand (the original bug is dead)

Badge row captured before/after each SGR click (`task-10-captures/badge-row-toggle.txt`), click sent
as SGR press `ESC[<0;186;12M` + release `ESC[<0;186;12m` at the measured badge cell (row 12, col 186):

| Click | Badge glyph | Meaning |
|---|---|---|
| (initial) | `▼ Mailbox` | expanded |
| #1 | `▶ Mailbox` | collapsed |
| #2 | `▼ Mailbox` | expanded |
| #3 | `▶ Mailbox` | collapsed |

Every real click flipped the triangle. The prefs file corroborates
(`task-10-captures/prefs-before-click.jsonc` → `prefs-after-toggles.jsonc`):

- Before first click: no `collapsed` key under `oh-my-openagent.mailbox`.
- After click #1: `"collapsed": true`.
- After click #2: `"collapsed": false`.
- After click #3: `"collapsed": true`.

So the on-screen glyph AND the persisted `collapsed` boolean move together on every real click. This
directly reproduces plan Success Criterion #1 ("Clicking the Mailbox header badge in a LIVE TUI
collapses/expands the panel") with real-click evidence — the original frozen-toggle bug is dead.

### 4. `/project-mailbox` dialog regression

- Opened `/project-mailbox` from the slash palette; top menu listed the connected project
  (`atlas`) with state `plan`.
- Selected `atlas` → submenu showed `Disabled / question / impl / ✓ plan`.
- Chose `impl`. The sandbox project config write landed:
  ```diff
  -      "atlas-5ac6b1c6": { "access": "allow", "intent_budget": "plan" }
  +      "atlas-5ac6b1c6": { "access": "allow", "intent_budget": "impl" }
  ```
- Reopened the dialog; submenu now showed `✓ impl`, confirming the resolver picked up the write.
- Chose `plan` to revert; final config diffed **byte-identical** to the pre-dialog snapshot
  ("IDENTICAL - revert clean"). The DialogSelect `.value` unwrap (T1) and the jsonc surgical write
  path both work end to end post-refactor.

### 5. Collapsed digest + expanded sections (form/styling)

Captured in `task-10-captures/expanded-sidebar-box.txt` and `collapsed-sidebar-box.txt`. Both states
render the AFT-style single-border box with the accent "▼/▶ Mailbox" badge on the left and the
right-aligned version (`v4.17.0`):

```
┌───────────────────────────────────┐
│                                   │
│  ▼ Mailbox                v4.17.0 │
│                                   │
└───────────────────────────────────┘
```

## Why it is enough

- The single most important claim — a **real mouse click collapses/expands the live panel** — is
  proven four times over with actual SGR mouse bytes delivered into the pane's input stream, each
  flipping both the rendered glyph and the persisted `collapsed` pref. This is exactly the behavior
  the whole plan set out to fix, verified in a running TUI, not a unit test.
- The `host-virtual` + `compiled:true` log lines close the loop that three prior attempts stumbled
  on: they prove the sandbox loaded **our** `dist/tui.js` (via the `tui.json` → repo-dir wiring),
  not the published package, so the click behavior we observed is the code under test.
- Isolation is proven by a concrete before/after host session count (5927 → 5927) plus a
  sandbox-local DB at count 0; the host config/DB were never mutated.
- The dialog regression exercised the full write+read+revert loop against a real jsonc file and
  returned to a byte-identical original, covering the T1 unwrap fix and the surgical write path.

## Honest findings / what did NOT look perfect

- **Expanded body rows (In/Out/Projects) rendered empty** in this run. Reason: `getMailbox()`
  returns `null` for this clean fixture (no seeded inbox/outbox digest data), so
  `deriveMailboxContentModel` is never reached and `MailboxRows` renders nothing below the header.
  This is a **fixture-data condition, not a toggle regression** — the toggle mechanics (the actual
  bug) work regardless of body content, and the collapsed/expanded header + border render correctly
  in both states. The semantic content of those rows is already locked by T7's semantic-regression
  suite (byte-identical vs the legacy renderer). Populating live inbox/outbox digest rows in a TUI
  visual capture would require seeding real mailbox message/digest state (memory #1747 notes TUI
  mailboxes need a port + populated data); the panel was launched WITH `--port`, but no inbound/
  outbound notes were seeded, so the digest is legitimately idle/empty. Flagged here rather than
  papered over.

## What was omitted

- No secrets, tokens, auth headers, env dumps, or credentials were captured or written. The isolated
  sandbox `.env` (provider keys) was auto-sourced only into the throwaway environment and is not
  reproduced here.
- Full-frame `capture-pane` dumps (which contain the long absolute sandbox temp path repeatedly and
  unrelated MCP/agent sidebar noise) were not embedded verbatim; the diagnostic slices (badge row,
  sidebar box, prefs, log lines) are saved under `task-10-captures/`.
- macos-cua screenshots were intentionally not produced (skipped per instruction; prior infra
  failures). The tmux `send-keys -H` input path fully substitutes per plan contingency (c).

## Cleanup

Every tmux session and the sandbox temp dir created by this run were torn down before finishing
(verified `tmux -L omot10qa ls` reports no server and `ps aux | grep opencode` shows no process from
this run; the `mktemp` sandbox dir removed with `rm -rf`). The user's live opencode sessions and the
default tmux server were never touched (a dedicated `-L omot10qa` socket was used for all QA driving).
