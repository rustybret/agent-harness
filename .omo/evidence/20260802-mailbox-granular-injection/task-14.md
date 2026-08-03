# Task 14 — Config schema regen + docs + roadmap

## WHAT WAS TESTED

- **`worker_pr_variant` config field (TDD):** added 3 given/when/then cases to
  `packages/omo-opencode/src/features/cross-project-mailbox/config.test.ts` BEFORE wiring the
  field — valid value (`cloudhome`/`local` kept), omitted (undefined), invalid (`remote` throws).
  Ran RED first (3 fail), added the field, ran GREEN.
- **Schema regen additive-only:** snapshotted `assets/oh-my-opencode.schema.json`, ran
  `bun run build:schema`, diffed before/after (the plan's dirty-diff QA scenario).
- **Typecheck:** `bun run typecheck` over the full workspace.
- **Docs:** `docs/reference/cross-project-mailbox.md` extended with the 6 mode values,
  `allowed_modes` + `worker_pr_variant` config, routing lanes, and a Phase-1/Phase-2 roadmap.

## WHAT WAS OBSERVED

- **RED → GREEN:** config.test.ts went 13 pass / 3 fail (field stripped) → 16 pass / 0 fail after
  adding `worker_pr_variant: z.enum(["local","cloudhome"]).optional()` to `SenderConfigSchema`.
- **Broader suite unbroken:** config + permission-matrix + permission-tiers = 234 pass / 0 fail.
- **Schema diff = strictly additive.** `diff /tmp/schema-before.json assets/oh-my-opencode.schema.json`
  reported `6748a6749,6771` (an APPEND hunk). Counted lines: 0 removals (`^<`), 23 additions (`^>`).
  Both `allowed_modes` (enum array of the 6 modes) and `worker_pr_variant` (enum `local`/`cloudhome`)
  were added under the `senders` additionalProperties object. Zero existing fields removed or type-changed.
- **`requested_mode` clarification:** `requested_mode` is an ENVELOPE/tool-arg field (wire format),
  NOT a user-config field, so it correctly does NOT appear as a property in
  `oh-my-opencode.schema.json` (which only models user config). Its single textual occurrence in the
  schema is inside the `allowed_modes` description. `requested_mode` validation lives in the envelope
  schema (task-1) and the tool arg schemas (task-3), which are not part of the config JSON schema.
  This is expected, not a gap.
- **Typecheck:** the ONLY error is `router/classifier.ts` — an untracked file being created by
  **task-13 (parallel work, not in HEAD, not this task's scope)**. Filtering that file out, zero
  typecheck errors are introduced by task-14's four files
  (`config.ts`, `config.test.ts`, `oh-my-opencode.schema.json`, `docs/reference/cross-project-mailbox.md`).

## WHY IT IS ENOUGH

- The field follows task-2's `allowed_modes` precedent exactly: a bare `z.enum(...).optional()` with
  NO `.transform()`, so the JSON-schema enum metadata is preserved (memory #1570). The generated
  schema confirms the enum list `["local","cloudhome"]` is intact.
- The additive-only diff (0 removals) directly satisfies the plan's QA scenario: "schema diff shows
  only additive fields; failure = dirty-diff". No dirty diff observed.
- The runtime type of the real field is `"local" | "cloudhome" | undefined`, matching the structural
  `WorkerPrVariantSenderConfig` type that task-11's `selectWorkerPrVariant` was pre-built to accept,
  so task-11 now works against the real field with no further change.
- Docs cover every new surface introduced by this plan (6 modes with required tiers, both config
  fields, all routing lanes, the manual-drain surfacing note, and the deferred orchestrator roadmap
  from draft decisions D1/D2).

## WHAT WAS OMITTED

- **No `docs/guide/` edit.** The only `docs/guide/` mailbox mentions are Team Mode's *internal team
  mailbox* (`docs/guide/team-mode.md`), a different feature from the cross-project mailbox. Adding
  cross-project mode docs to a Team Mode page would be noise; `docs/reference/cross-project-mailbox.md`
  is the correct home. Noted, no scope-expansion.
- **No `AGENTS.md` edit.** The repo-root AGENTS.md TOOL CATALOG lists tool NAMES + gating conditions
  only (`project_message`/`project_note` (+4, `cross_project_mailbox.enabled`)); it documents no
  per-tool argument detail for ANY tool. Per step 6's explicit guard, adding `requested_mode` arg
  detail there would be inconsistent noise, so no change was made.
- **No commit.** Per the workflow, this subagent commits nothing. The pre-commit model-cache
  auto-absorb behavior (memory #2455) was not triggered because nothing was committed;
  `utils/models*.json` were not touched.
- **No raw schema hand-edit.** `assets/oh-my-opencode.schema.json` was regenerated via
  `bun run build:schema` only, never hand-edited.

## COMMANDS

```
# RED
bun test packages/omo-opencode/src/features/cross-project-mailbox/config.test.ts   # 13 pass / 3 fail
# (add field to config.ts) GREEN
bun test packages/omo-opencode/src/features/cross-project-mailbox/config.test.ts   # 16 pass / 0 fail
# schema regen + diff
cp assets/oh-my-opencode.schema.json /tmp/schema-before.json
bun run build:schema
diff /tmp/schema-before.json assets/oh-my-opencode.schema.json   # 6748a6749,6771 (append only; 0 removals, 23 additions)
# broader suite
bun test .../config.test.ts .../permission-matrix.test.ts .../permission-tiers.test.ts   # 234 pass / 0 fail
# typecheck (only error is task-13's untracked router/classifier.ts)
bun run typecheck
```
