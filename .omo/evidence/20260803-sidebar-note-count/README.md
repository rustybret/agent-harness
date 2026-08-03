# QA evidence — sidebar `inboundUnread` counted stale non-envelope markdown

Date: 2026-08-03
Change: `packages/omo-opencode/src/features/cross-project-mailbox/` — envelope-validate the sidebar
note count so it matches the delivery path's definition of a note.
Roadmap item: P0-1 in `.omo/plans/tooling-improvement-roadmap.md`.

## What was tested

The production TUI sidebar read path, driven end to end against a fixture repository:

    readView(root)
      -> loadMailboxSection
        -> validatePluginConfig + applyMailboxDefault
          -> readMailboxSidebarState
            -> countNotes -> isNoteFile

Fixture repo: a temp directory with `.omo/omo.jsonc` enabling the mailbox under the `[opencode]`
harness key, and `coordination_notes/cloudhome-a1b2c3d4/` containing exactly four `.md` files:

| file            | shape                                              | should count |
| --------------- | -------------------------------------------------- | ------------ |
| `real-note.md`  | genuine envelope built with `serializeEnvelope()`   | yes          |
| `NOTES.md`      | hand-authored markdown, no frontmatter              | no           |
| `design.md`     | frontmatter present but NOT a mailbox envelope      | no           |
| `handoff.md`    | plain text, no frontmatter                          | no           |

This reproduces the exact shape cloudhome reported: legacy coordination docs parked in the inbox
directory inflating the unread badge.

Driver: `drive.ts` (copied into this directory). Run under an isolated `HOME` so the developer's real
`~/.omo/omo.jsonc` does not participate — see the isolation note below.

## What was observed

Before the fix (production code stashed back to suffix-only `isNoteFile`):

    observedInboundUnread: 4      <- all four files counted, 3 of them wrong

After the fix:

    observedInboundUnread: 1      <- only the genuine envelope counted

Full captures: `before.json`, `after.json`.

Automated coverage added alongside (`sidebar/mailbox-sidebar.test.ts`): a hand-authored doc beside a
real note, a doc with non-envelope frontmatter, and a stale doc in the `processed/` dir. Scoped suite
`bun test packages/omo-opencode/src/features/cross-project-mailbox/ packages/omo-opencode/src/features/tui-sidebar/`
reported 842 pass / 0 fail. `lsp_diagnostics` clean on all three changed source files.

## Isolation

No opencode process was spawned, so no session could be written to
`~/.local/share/opencode/opencode.db`; the driver imports the plugin's own modules directly and only
reads/writes its own `mktemp` fixture directory. The developer's real `~/.omo/omo.jsonc` was
neutralized by pointing `HOME` at a throwaway directory containing an empty `{}` config, which also
kept the run from reading personal project-registry or mailbox grants.

## Why this is enough

The assertion is made on the value the sidebar actually renders (`mailbox.inboundUnread` off
`readView`), not on the helper in isolation, and the before/after pair was produced by stashing and
restoring the real production files — so the delta is attributable to the change and nothing else.
The three stale-doc shapes cover every way cloudhome's legacy docs can appear: no frontmatter,
non-envelope frontmatter, and arbitrary prose.

Residual risk: `hasValidEnvelopeFrontmatter` reads only the first 4 KiB of each file. A note whose
frontmatter block exceeded 4 KiB would be classified as stale and undercount. Real envelopes are ~16
short scalar fields plus a bounded `hopPath`, so this is far out of reach, but it is a deliberate
bound rather than an impossibility.

## What was omitted

The fixture config and driver contain no credentials. The `probe.ts` exploration run in the session
printed the developer's live mailbox grants (project ids and intent budgets); that output is NOT
copied here and the probe scripts are not included.
