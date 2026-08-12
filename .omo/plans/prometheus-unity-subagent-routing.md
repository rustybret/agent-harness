# prometheus-unity-subagent-routing - Work Plan

## TL;DR (For humans)

- **What you'll get:** Prometheus (the planner) and the ulw-plan skill explicitly teach Unity-codebase recognition and route Unity engine/asset/script work to the 7 specialized Unity domain subagents via `Recommended task executor category: subagent_type: "..."` annotations, plus the codified dual-layer rule (AFT read-only tools for code intelligence, SuperMCP bridge tools for engine mutations). Roadmap Item 10 marked DONE.
- **Why this approach:** content-pin tests (TDD) lock the new guidance so future prompt refactors cannot silently drop it; the shared-skills copy is the only one OpenCode consumes, so Codex/Senpi copies stay untouched.
- **What it will NOT do:** no changes to Codex/Senpi ulw-plan copies, start-work SKILL.md, `.opencode/agents/*.md`, the producer-contract grammar paragraphs, or the pinned dist signature line.
- **Effort:** small (2 markdown content files + 2 new test files + roadmap + evidence). ~4 implementation todos, 2 final verifiers.
- **Risk:** low. Markdown-only product change; the one regression hazard (dist signature pin) is explicitly guarded by a test that already exists.
- **Decisions adopted:** (1) Prometheus `default.md` gets a compact routing paragraph and defers the full table to ulw-plan (the file's own "do not restate" philosophy); (2) the full routing table + dual-layer rule land in `full-workflow.md` next to the existing category vocabulary; (3) SKILL.md gets a router-level invariant bullet pointing at the table; (4) `unity-gamedev` is intentionally excluded (workflow skill, not in the requested executor set).

## Scope

**In scope (exact files):**
1. `packages/prompts-core/prompts/prometheus/default.md` - append Unity-recognition + subagent-routing paragraph.
2. `packages/shared-skills/skills/ulw-plan/references/full-workflow.md` - new `### Domain-specialized executor routing (Unity)` subsection after the category-vocabulary blockquote.
3. `packages/shared-skills/skills/ulw-plan/SKILL.md` - one new bullet in `## Universal invariants` pointing at the routing table.
4. NEW `packages/prompts-core/src/prometheus-prompts.test.ts` - content-pin test.
5. NEW `packages/shared-skills/ulw-plan-unity-routing.test.ts` - content-pin test.
6. `.omo/plans/tooling-improvement-roadmap.md` - mark Item 10 DONE + Done-section entry.
7. `.omo/evidence/20260812-unity-planning-guidance/` - QA evidence.

**Must-NOT-Have (guardrails, not reductions):**
- MUST NOT touch `packages/omo-codex/plugin/components/ultrawork/skills/ulw-plan/**` or `packages/omo-senpi/**`.
- MUST NOT touch `packages/shared-skills/skills/start-work/SKILL.md`.
- MUST NOT modify the two verbatim "Plan artifact producer contract" paragraphs' grammar text.
- MUST NOT remove or reword `default.md`'s pinned line "Your FIRST action in every planning session is to LOAD the ulw-plan skill".
- MUST NOT edit `.opencode/agents/unity-*.md`, any TS source, or any config schema.
- MUST NOT use em dashes or en dashes in any new content.
- MUST NOT include `unity-gamedev` in the executor list.

## Verification strategy

Test strategy: **TDD**. Each content todo writes its failing content-pin test first, confirms red with a scoped `bun test <path>`, then edits the markdown to green.

Gates, in order:
1. Scoped: `bun test packages/prompts-core` and `bun test packages/shared-skills`.
2. Full: `bun test` and `bun run typecheck`.
3. `aft_inspect` scoped to `packages/prompts-core` and `packages/shared-skills`.
4. QA evidence: `bun run build` then `bun test packages/omo-opencode/src/shared/dist-bundle-prompt-content.test.ts`, plus a runtime loader proof.

## Execution strategy

Ultrawork execution, 2 waves + final verification.

- **Wave 1 (parallel, independent):** Todos 1 and 2.
- **Wave 2 (after Wave 1):** Todo 3, then Todo 4.
- **Final verification wave (parallel):** F1, F2.

## Todos

- [ ] 1. `packages/prompts-core`: teach Prometheus Unity domain-subagent routing (TDD)
  Recommended task executor category: `quick`
- [ ] 2. `packages/shared-skills`: codify Unity routing table + dual-layer rule in ulw-plan (TDD)
  Recommended task executor category: `quick`
- [ ] 3. QA evidence: prove the new guidance ships through the real OpenCode surfaces
  Recommended task executor category: `unspecified-high`
- [ ] 4. Roadmap: mark Item 10 DONE
  Recommended task executor category: `writing`

## Final verification wave

- [ ] F1. Full gates: run `bun test`, `bun run typecheck`, and `aft_inspect` scoped to `packages/prompts-core` + `packages/shared-skills`.
- [ ] F2. Scope fidelity + content review: verify `git diff dev...HEAD --stat` touches ONLY in-scope paths.
