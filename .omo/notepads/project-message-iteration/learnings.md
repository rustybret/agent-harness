# Learnings — project-message-iteration

## Key architecture facts (pre-confirmed)
- `resolveActivePrimaryAgent` reads `agentPrimaryCache` — a Map NEVER populated in production (only `.observe()` feeds it, and nothing calls `.observe()`)
- The live store is `sessionAgentMap` in `claude-code-session-state/state.ts`, populated by `updateSessionAgent()`
- `getSessionAgent(sessionId)` returns a `normalizeStoredAgentName`-processed string (NOT config-key)
- `resolveRegisteredAgentName()` (state.ts:55) DOES config-key canonicalization via `getAgentConfigKey`
- Magic Context DEFAULT_SLOT_ORDER = 200 (magic-context/packages/plugin/src/shared/tui-preferences.ts:67)
- Mailbox slot must be order 150 (< 200) to render above Magic Context
- Builtin categories: visual-engineering, ultrabrain, deep, artistry, quick, unspecified-low, unspecified-high, writing
- Subagent types eligible for AGENT_TIER (question): explore, librarian, oracle, metis, momus
- Legacy intent map: quick→impl, review→plan, work-loop→plan (identity for question/impl/plan)
- Envelope parseEnvelope MUST still accept all 6 legacy values at parse boundary; canonicalize AFTER

## Source file locations (verified)
- primary-resolver: packages/omo-opencode/src/features/cross-project-mailbox/primary-resolver/
- idle-drain-hook: packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-hook.ts
- config: packages/omo-opencode/src/features/cross-project-mailbox/config.ts
- envelope schema: packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema.ts
- validate-inbound: packages/omo-opencode/src/features/cross-project-mailbox/validate-inbound.ts
- send-preflight: packages/omo-opencode/src/features/cross-project-mailbox/send-preflight.ts
- session state: packages/omo-opencode/src/features/claude-code-session-state/state.ts
- agent display names: packages/omo-opencode/src/shared/agent-display-names.ts
- getServerBaseUrl: packages/omo-opencode/src/shared/opencode-http-api.ts:49
- monitor/permission.ts (bashPermissionAsk pattern): packages/omo-opencode/src/features/monitor/permission.ts
- spawn helper: packages/omo-opencode/src/shared/spawn-with-windows-hide.ts
- tui.ts slot registration: packages/omo-opencode/src/tui.ts:30-54,183
- render-view.ts mailbox: packages/omo-opencode/src/render-view.ts:270-307
