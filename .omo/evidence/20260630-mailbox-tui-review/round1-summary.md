# Dual high-accuracy review — Round 1

Date: 2026-06-30
Plan: .omo/plans/mailbox-tui-sidebar-and-hot-reload.md

## Reviewers
- Codex CLI gpt-5.5 xhigh, isolated CODEX_HOME (real ~/.codex untouched — config.toml shasum
  identical before/after: ccd4a92b...). Verdict: **REJECT**. Full transcript: codex-review.txt.
- Native Momus (kimi-k2.7-code). Streamed reject-trending reasoning; clean verdict block
  truncated by the bg-completion interrupt. Unique concern raised: `runSendPreflight` signature
  — RESOLVED on direct check (send-preflight.ts:29 already takes `config`; no refactor needed).

## Codex blockers (all verified against source)
- B1: T1 `.default()` on the ROOT field is unsafe — config-merger.ts:8-10 shallow-spreads
  `...override` (cross_project_mailbox NOT deep-merged), so a nearer layer's defaulted block
  clobbers a user's explicit enabled:false. FIX: keep field OPTIONAL, inject populated default
  POST-MERGE (mergeLoadedConfig + loadPluginConfig path) only when undefined.
- B2: T4 auto-provision unreachable — create-mailbox-session-hooks.ts:18 fires only when merged
  config falsy; T1 makes it always truthy. FIX: trigger on absent PROJECT-LAYER block, not
  merged-config falsiness; gate on existing .opencode/ for fs hygiene.
- B3: T3 comment-json absent — package.json:31 has jsonc-parser, not comment-json; JSON fallback
  destroys sibling comments. FIX: jsonc-parser modify/applyEdits surgical edits.
- B4: T6 body cap — envelope/schema.ts:6,32 hard-caps at MAX_BODY_BYTES=32768 regardless of
  config; config.ts:25 max_body_bytes has no max. FIX: effective cap = min(config, 32768);
  raising config above 32768 is a no-op (documented), lowering hot-reloads.
- B5: T5 bounded window — readRecentSent (mailbox-sidebar.ts:67-79) reads+parses whole log then
  slices 3. FIX: bound READ+PARSE+STAT to last OUTBOX_ACK_WINDOW tail lines.

## Codex non-blocking (folded)
- validatePluginConfig(directory) is read-only, right tool for lazy reload; on valid:false use
  last-known-good (not the partial/defaulted parse).
- Tests to update beyond config.test.ts:15 → create-mailbox-session-hooks.test.ts:36.

## Outcome
All 5 blockers + 2 non-blocking folded into plan v2. Proceeding to Round 2 dual review.
