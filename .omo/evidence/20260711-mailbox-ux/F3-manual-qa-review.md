# F3 — Real Manual QA Authenticity Review (mailbox-ux, T14)

**Verdict: APPROVE**

Read-only skeptical audit of the T14 opencode-qa evidence against the actual
production source in worktree `feat/project-mailbox-ux`. Every load-bearing claim
in the evidence cross-checks against the real code. The honestly-flagged gaps are
credible, non-fatal, and the alternate proof method (direct invocation of the real
production modules with real file I/O) is legitimate evidence of correctness. No
fabrication detected.

---

## Point 1 — All T14 evidence files read

Read all T14 artifacts: `T14-dialog-diff.txt`, `T14-esc-persist.txt`,
`T14-first-registration.txt`, `T14-isolation-proof.txt`, `T14-observed.md`,
`T14-omitted.md`, `T14-tui-sidebar.txt` (via the boot render quoted in
`T14-observed.md` / `T14-dialog-diff.txt` banner), `T14-what-tested.md`,
`T14-why-enough.md`. Files are internally consistent: each unproven-live path is
disclosed in the SAME file set (`T14-omitted.md`, `T14-why-enough.md`) rather than
buried or spun.

## Point 2 — Claims vs. production source: ACCURATE

**`dialog/tui-command.ts` — the cited path is real and line numbers match.**
- `registry.listProjects()` → line 38.
- `buildTopMenu(...)` → line 44.
- `buildSubmenu(selectedRow)` → line 57.
- `applySelection(text, ...)` → line 97.
- atomic write `writeFile(tmp)` → `rename(tmp, configPath)` → lines 110–113.
- `T14-dialog-diff.txt` cites "the same onSelect write path ... lines 68–113".
  Verified: `onSelect` opens at line 67, `queueWrite` at 68, `rename` at 113. The
  cited range is byte-accurate.
- The self-skip guard the evidence leans on is real: line 24
  `if (!api.keymap?.registerLayer || !api.ui?.DialogSelect || !api.ui?.dialog)` →
  logs `"[mailbox-dialog] required TUI APIs absent, skipping /project-mailbox
  registration"` (line 25). This is exactly the log line quoted in
  `T14-dialog-diff.txt`. The "command self-skips on opencode v1.17.18" claim is
  grounded in real code, not invented.

**`registry/project-registry.ts` — `registerProject()` claims hold.**
- Returns `{ created: boolean }`: signature line 123, `return { created }` line 142.
- `created = existing === undefined` (line 129).
- `registeredAt` preservation on re-register: the entry is built as
  `{ ...(existing ?? {}), projectId, repoRoot, displayName, lastSeen: now,
  ...(created ? { registeredAt: now } : {}) }` (lines 131–138). On re-register
  `created` is false, so `registeredAt: now` is NOT added, and the spread of
  `existing` carries the original `registeredAt` forward untouched. `T14-first-
  registration.txt`'s claim (returns `created`, preserves `registeredAt`) is
  correct.

**JSONC comment-preservation claim is PLAUSIBLE and correct.**
- The config write path is `applySelection` in `dialog/menu-model.ts`, which uses
  `modify` + `applyEdits` from `jsonc-parser` (lines 1, 120–140) — NOT
  `JSON.stringify`. Surgical edits preserve surrounding comments/formatting. The
  `T14-dialog-diff.txt` before/after (leading `// T14...` block comment and inline
  `// keep enabled (trailing comment must survive)` both surviving) is consistent
  with this implementation.
- Note: `project-registry.ts.atomicWrite` DOES use `JSON.stringify` (line 207), but
  that writes the registry JSON (`~/.omo/project-registry.json`), a comment-free
  file — a different artifact from the `.opencode/oh-my-openagent.jsonc` config the
  comment claim is about. No contradiction.

## Point 3 — Honest gaps are credible and non-fatal

- **No live TUI dialog keypress**: cause is the line-24 guard firing because
  opencode v1.17.18's plugin surface lacks `api.keymap.registerLayer` /
  `api.ui.DialogSelect`. Verified in source. Credible, and it is the harness's
  surface, not a defect in the feature logic.
- **Alternate proof is legitimate**: `T14-dialog-diff.txt` drives the exact modules
  the `onSelect` handler calls (`listProjects → buildTopMenu → buildSubmenu →
  applySelection → atomic rename`) with a real sandbox registry and real file I/O,
  producing a real before/after diff and a real atomic `rename`. The only untested
  segment is opencode's own keymap/DialogSelect callback wiring — everything the
  feature actually owns (menu construction, selection→config edit, comment-safe
  atomic write, self-exclusion of `selfProjectId`) is exercised against production
  code. This is proper evidence of correctness, not a stand-in.
- **No toast capture**: `api.ui.toast` requires a live TUI + provider creds the
  sandbox lacks. The toast/error path (`MalformedConfigError → api.ui.toast`) is
  present in source (tui-command lines 100–104, 121–125) but not live-fired.
  Documented, non-fatal.

## Point 4 — Plan T14 annotation does NOT overclaim

`.omo/plans/mailbox-ux.md` line 181 marks T14 ✅ DONE and states: build clean,
sandboxed opencode booted, isolation proven (separate `HOME`/`XDG_*`, real config/db
untouched by sandbox), `/project-mailbox` reachable in command flow, and explicitly
that "multi-project dialog/persistence/first-registration paths documented as
not-observed-live in `T14-omitted.md` and covered by T13 integration + T5/T6 tests."
The annotation routes the reviewer to the gap file rather than papering over it —
faithful to the evidence.

Minor caveat (not blocking): "`/project-mailbox` reachable in command flow" is mildly
generous — in the live TUI the command self-skipped registration and returned "No
matching items", so it was typed/evaluated but not actually registered as a
selectable command. `T14-why-enough.md` and `T14-omitted.md` state this plainly, so
the honest record is intact.

## Point 5 — Isolation spot-check: HOLDS

`T14-isolation-proof.txt` shows a real before/after of the un-sandboxed store:
- All `~/.config/opencode/*` shasums identical before vs after EXCEPT
  `antigravity-accounts.json` (mtime+shasum changed).
- `opencode.db` session_count 5843 → 5844 (+1), size grew.
The evidence attributes these deltas to the concurrent HOST opencode session (this
QA is driven by a live agent running under the real `$HOME`; `ps` shows 17 opencode
processes), NOT the sandbox. The decisive isolation proof is credible: the sandbox
created its OWN DB at `/tmp/t14-qahome.*/data/opencode/opencode.db` containing exactly
2 sessions (its 2 TUI launches). Had isolation failed, the real DB would have gained
those ~2 QA sessions and no sandbox DB would exist. Instead the sandbox DB holds the
2 QA sessions and the real DB gained only +1 (the host). The `antigravity-accounts.json`
change is a host-session auth refresh, unrelated to mailbox QA. The confound is real
and correctly reasoned. Sandbox config/cache/runtime paths in the OMO log are all
`/private/tmp/t14-qahome.*`-relative. Isolation held.

Minor cosmetic inconsistency (not blocking): sandbox project labels drift across
files (`qa-proj-a`, `proj2`, `proj1`/`proj3`). This is loose labeling of the throwaway
sandbox projects and does not affect any correctness or isolation conclusion.

---

## Summary

- Point 1 (files read): ✅
- Point 2 (claims vs source): ✅ accurate, line numbers verified
- Point 3 (gaps credible / alternate proof legitimate): ✅
- Point 4 (plan annotation no overclaim): ✅ (one mild-generous phrase, disclosed in gap files)
- Point 5 (isolation): ✅ held, deltas correctly attributed to host confound

The evidence is authentic and honestly scoped. It cleanly separates live-proven
(build, boot, isolation, command self-skip behavior), module-proven (dialog write
path, comment preservation, atomic write, self-exclusion), and not-observed-live
(TUI keypress, toast, first-registration timestamp — deferred to unit/integration
coverage). Nothing is fabricated. **APPROVE.**
