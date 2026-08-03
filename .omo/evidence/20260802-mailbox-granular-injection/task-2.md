# Task 2 — Mode gating: mode→tier map + per-sender allowed_modes config + downgrade decision

## WHAT WAS TESTED
Pure receiver-side mode-permission logic for cross-project mailbox notes (no I/O, no harness spawn — this task is pure library code, so QA is the unit matrix + typecheck gate, not an opencode-qa drive):

1. `MODE_TIER` / `MAILBOX_MODES` / `modeWithinBudget()` in `permission-tiers.ts`.
2. `allowed_modes` field on `SenderConfigSchema` + the pure `decideDowngrade()` in `config.ts`.

Commands run:
- `bun test packages/omo-opencode/src/features/cross-project-mailbox/permission-tiers.test.ts permission-matrix.test.ts config.test.ts`
- `bun test packages/omo-opencode/src/features/cross-project-mailbox/` (full feature dir)
- `bun run typecheck` (full workspace)

## WHAT WAS OBSERVED
- The 3 directly-modified test files: **230 pass, 0 fail, 365 expect() calls** (`[134.00ms]`).
- Full cross-project-mailbox dir: **613 pass, 1 fail, 1 error** — the sole failure is `todo-inject/todo-inject.test.ts` failing to import `./todo-inject`, which is **task-5's in-progress module (parallel Wave-1 work), NOT this task**. Every permission-tiers / permission-matrix / config / validate-inbound test is green.
- `bun run typecheck`: clean across all 27 workspace tsconfig projects (tsgo --noEmit, no errors emitted).

### Matrix coverage proving the rule
`decideDowngrade` matrix = 6 modes × 3 budget ceilings × 3 allowlist shapes (absent / present-including / present-excluding) = 54 cells, plus:
- within-budget + allowed ⇒ mode kept, no reason.
- over-budget ⇒ downgrade `effectiveMode: undefined`, `downgradeReason: "mode-over-budget"`.
- disallowed (allowlist present, omits mode) ⇒ downgrade with `"mode-not-allowed"`.
- over-budget AND disallowed simultaneously ⇒ budget wins (`"mode-over-budget"`).
- **no `requested_mode` ⇒ legacy path: `effectiveMode: undefined` with NO `downgradeReason`** (proves the legacy triage path is untouched).

`modeWithinBudget` and `decideDowngrade` matrices each use a hand-authored independent oracle (mode→tier table NOT importing `MODE_TIER`), so the assertions are a real external check, not a restatement of production data.

### Legacy-behavior invariant (MUST-NOT)
`validation/validate-inbound.ts` was **not modified**. `decideDowngrade` is not wired into any drain/validation path yet (that is task-4/task-12). The pre-existing `permission-matrix.test.ts` sender-preflight + inbound-validation matrix (18 subjects × 3 ceilings) and all `config.test.ts` cases pass byte-identically. Notes carrying no `requested_mode` are provably unchanged.

## WHY IT IS ENOUGH
This task's deliverable is pure, deterministic library code with a well-defined finite input space. The exhaustive (mode × ceiling × allowlist-shape) matrix enumerates every meaningful cell, the independent-oracle construction guards against the test merely echoing the implementation, and the "no requested_mode" cases lock the legacy path. typecheck confirms the new exports (`MAILBOX_MODES`, `MailboxMode`, `MODE_TIER`, `modeWithinBudget`, `SenderConfigSchema`, `SenderConfig`, `DowngradeDecision`, `decideDowngrade`) compile and are consumable by downstream tasks. No harness-connected surface changed, so an opencode-qa sandbox drive is not applicable to this task.

## WHAT WAS OMITTED
- No secrets, tokens, env dumps, or auth headers were produced or captured.
- The `todo-inject.test.ts` failure is out of scope (task-5); not investigated or altered here.
- Schema JSON regen (`bun run build:schema`) is explicitly task-14's responsibility; deliberately not run to keep this task scoped. The `allowed_modes` field uses a bare `z.enum` array (no `.transform()`) specifically so task-14's regen emits the enum list correctly (memory #1570).
