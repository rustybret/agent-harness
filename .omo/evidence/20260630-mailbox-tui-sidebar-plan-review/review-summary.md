# Dual High-Accuracy Review: mailbox-tui-sidebar-and-hot-reload

**Date:** 2026-06-30
**Plan:** .omo/plans/mailbox-tui-sidebar-and-hot-reload.md
**Reviewers:** Momus (native) + Codex CLI gpt-5.5 (isolated CODEX_HOME)
**Rounds:** 8
**Total blockers surfaced:** 20
**Final verdict:** APPROVE (Momus R8) / Codex sandbox exhausted after R7

## Host config.toml integrity
shasum before/after all rounds: ccd4a92b26ce4d907b52f7e2cd122e134506bed8 (unchanged)

## Blockers resolved by round

### Round 1 (B1-B5, Codex REJECT)
- B1: config-merger shallow-spread clobbers user `enabled:false` — fix: inject default POST-merge only
- B2: auto-provision trigger unreachable when T1 always populates merged config
- B3: plan cited `comment-json` but omo depends on `jsonc-parser` (absent from package.json)
- B4: T6 body cap against `config.bounds.max_body_bytes` ignored static `MAX_BODY_BYTES` cap
- B5: `readRecentSent` read+parsed entire file before slicing — must tail-slice BEFORE parse

### Round 2 (C1-C4, Codex REJECT)
- C1: T10 `queueTuiPreferenceUpdate(["oh-my-openagent","mailbox","collapsed"],...)` double-prefixes root key (helper prepends it internally, path arg must be `["mailbox","collapsed"]`)
- C2: T6 "What to do" referenced `deps.directory` which does not exist on `ProjectMessageToolDeps`
- C3: F4 verification check incompatible with T5's bounded read approach
- C4: auto-provision stub wrote `enabled:false` instead of `enabled:true`

### Round 3 (D1-D6, Codex REJECT)
- D1: T4 trigger still used hardcoded `existsSync(".opencode/oh-my-openagent.jsonc")` — must use `detectPluginConfigFile`
- D2: T7 drain hot-reload lacked last-good fallback on malformed config
- D3: T4 must NOT write stub when merged `enabled` is explicitly `false`
- D4: `detectPluginConfigFile` caches "none"; must call `clearPluginConfigFileDetectionCache()` after stub write
- D5: T6 static `inputSchema` used `deps.config.bounds.max_body_bytes` (hot-reload-unsafe) — must use constant `MAX_BODY_BYTES`
- D6: T5 outbox bounding contradiction between "What to do" and F4

### Round 4 (E1-E2, Codex REJECT)
- E1: T6 AC contradicted itself — static schema must use `MAX_BODY_BYTES`, runtime uses `min(config.bounds.max_body_bytes, MAX_BODY_BYTES)`
- E2: T3 Must NOT conflated missing/empty (seed+write) with malformed (skip+preserve)

### Round 5 (F5, Codex REJECT / Momus OKAY)
- F5-1: `config.max_body_bytes` accessor (without `.bounds.`) in T6 AC and F1 (2 sites)
- F5-NB: T1 Blocks matrix listed T5 (T5 depends only on T2)

### Round 6 (F6, both REJECT)
- F6: T1 footer line 81 still said `Blocks: T4,T5,T6,T7` — matrix was fixed in R5 but footer missed

### Round 7 (F7, Momus REJECT / Codex OOC)
- F7: T3 References didn't specify `modify`/`applyEdits` come from the npm `jsonc-parser` package directly, NOT from `packages/utils/src/jsonc-parser.ts` (which doesn't export them)

### Round 8 (Momus APPROVE)
- No blockers. All 20 resolved.
