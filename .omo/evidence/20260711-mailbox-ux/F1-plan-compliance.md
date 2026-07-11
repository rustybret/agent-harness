# F1 Plan Compliance Audit

**Verdict: REJECT**

## Reason for Rejection
**Scope Creep Detected:** The files `utils/models+variants.json` and `utils/models.json` were modified in commit `9c1b95a05`. Although the plan states in T3 that these were removed via a "scope-creep amend" to commit `aad196d4a`, the actual branch still contains commit `9c1b95a05` with these unrelated changes. These files must be reverted/removed from the branch to comply with the strict "no scope creep" rule.

## Task Compliance Table

| Task | Criteria vs Evidence | Pass/Fail |
|------|----------------------|-----------|
| **T0** | Worktree exists, baseline green. | Pass |
| **T1** | `cross_project_mailbox` deep-merged in `config-merger.ts`. | Pass |
| **T2** | Auto-provision stub rewritten with comments, no `default_sender_access` or `enabled` keys. | Pass |
| **T3** | Seed `allow-all` into user-level config. Logic is correct, but commit includes unrelated `utils/models*.json` changes. | **Fail (Scope Creep)** |
| **T4** | `registeredAt` + first-insert detection in ProjectRegistry. | Pass |
| **T5** | Auto self-registration on session start wired in `create-mailbox-hooks.ts`. | Pass |
| **T6** | Live mailbox-config resolution with TTL cache and single-flight wired into permission paths. | Pass |
| **T7** | Presence detail, cache, and last-seen formatting implemented. | Pass |
| **T8** | `/project-mailbox` pure menu model implemented. | Pass |
| **T9** | Sidebar Projects section always renders headers, shows active counter and presence rows. | Pass |
| **T10** | `/project-mailbox` TUI command + dialog wired, atomic writes, resolver invalidated after write. | Pass |
| **T11** | First-registration toast and legacy-senders notice wired into TUI poll tick. | Pass |
| **T12** | Schema description updated and regenerated. | Pass |
| **T13** | Two-repo end-to-end integration test implemented and passing. | Pass |
| **T14** | opencode-qa manual evidence recorded in `.omo/evidence/20260711-mailbox-ux/`. | Pass |

## Must-NOT-Have Checklist

| Constraint | Verified How | Pass/Fail |
|------------|--------------|-----------|
| No opencode-core (fork) changes; plugin repo only. | Checked git diff; all changes are within the `agent-harness` repository. | Pass |
| No web UI work. No new agent-facing tools, no CLI subcommands. | Checked `tool-registry-mailbox-tools.ts` and CLI directories; no new tools or commands added. | Pass |
| No AUTOMATED/background modification of existing project-level configs. | T3 only modifies user-level config; T2 only writes to new projects. | Pass |
| No change to Zod schema defaults. | Checked `config.ts`; `default_sender_access` remains `allow-none`. | Pass |
| No registry entry deletion/pruning, no deregistration UI. | Checked `project-registry.ts` and `menu-model.ts`; no deletion logic exists. | Pass |
| No changes to permission-tier semantics or envelope/delivery formats. | Checked `permission-tiers.ts` and `envelope/schema.ts`; untouched. | Pass |
| Do not touch `.omo/run-continuation/`, do not commit to `fork/local` directly. | Checked git log; changes are on `feat/project-mailbox-ux` branch. | Pass |

## Required Actions
1. Rebase or amend the branch to remove the changes to `utils/models+variants.json` and `utils/models.json`.
2. Update the plan to reflect the correct commit hashes after the rebase.
