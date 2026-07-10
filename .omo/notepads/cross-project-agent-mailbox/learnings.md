# Learnings — cross-project-agent-mailbox

## Architecture
- New feature module: `packages/omo-opencode/src/features/cross-project-mailbox/`
- Flag default OFF: `cross_project_mailbox.enabled = false`
- teamIdForRoot canonicalizer in todo 2 must be shared exactly by todo 3's registry
- team-core MessageSchema is at `packages/team-core/src/types.ts` (NOT team-mode.ts which is a re-export)
- timestamp field: `z.number().int().positive()` (numeric epoch-ms, NOT ISO8601)
- correlationId in team-core: `z.string().uuid().optional()` — mailbox overrides to REQUIRED
- real 11-field team schema: `packages/team-core/src/config.ts`
- barrel for config: `packages/omo-opencode/src/config/schema.ts` (NO schema/index.ts)
- dispatchInternalPrompt MUST be used — never raw session.prompt/promptAsync (memory 584)
- Drain hook pattern: clone `packages/omo-opencode/src/hooks/team-session-events/team-idle-wake-hint.ts`
- Atomic writes: follow `packages/omo-opencode/src/features/team-mode/team-state-store/` pattern
- Registry: `~/.omo/project-registry.json`
