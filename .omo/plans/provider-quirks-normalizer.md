# Work Plan: Provider Quirks Normalizer

## TL;DR

> **Quick Summary**: Create a dynamic `providerQuirksNormalizer` message transform hook to handle conflicting API validation rules for `reasoning_content` across different providers (Cerebras, Groq, Moonshot). Atlas will delegate the implementation to Hephaestus.
> 
> **Deliverables**:
> - New transform hook: `src/hooks/provider-quirks-normalizer/hook.ts`
> - Registration in `src/plugin/hooks/create-transform-hooks.ts`
> - Unit tests for the hook
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: NO - sequential
> **Critical Path**: Task 1 → Task 2 → Task 3 → Final QA

---

## Context

### Original Request
The user reported `wrong_api_format` errors when calling Cerebras models (`messages.3.assistant.reasoning_content: property 'messages.3.assistant.reasoning_content' is unsupported`). The user requested a refactoring to support this provider, explicitly asking for Atlas to delegate the work to Hephaestus. Automated tests are required.

### Interview Summary
**Key Discussions**:
- **Cerebras**: Rejects requests if `reasoning_content` is in history.
- **Moonshot/Groq**: Rejects requests if `reasoning_content` is missing from history when thinking is enabled.
- **Test Strategy**: Automated tests are required (TDD/Tests-after).

**Research Findings**:
- The error occurs because Vercel AI SDK translates OpenCode's `ReasoningPart` (`{ type: "reasoning" }`) into `reasoning_content` in the API payload.
- We will use the `experimental.chat.messages.transform` hook to mutate the payload ephemerally before it is sent to the provider.

### Metis Review
**Identified Gaps** (addressed):
- **Ephemeral Mutation**: Guardrail added to ensure only the outgoing payload is mutated, not the persistent database history.
- **Empty Messages**: Guardrail added to ensure stripping reasoning doesn't leave an assistant message empty (inject `TextPart` if necessary).
- **Targeted Logic**: Logic must specifically target `assistant` messages to avoid injecting reasoning into `user` or `system` messages.
- **Explicit Prompting**: The plan includes exact delegation prompts for Atlas to send to Hephaestus.

---

## Work Objectives

### Core Objective
Implement a provider-specific normalization hook that dynamically strips or injects `ReasoningPart` blocks to satisfy strict API validators.

### Concrete Deliverables
- `src/hooks/provider-quirks-normalizer/hook.ts`
- `src/hooks/provider-quirks-normalizer/index.ts`
- `src/hooks/provider-quirks-normalizer/hook.test.ts`
- Updated `src/plugin/hooks/create-transform-hooks.ts`

### Definition of Done
- [ ] Tests pass verifying Cerebras reasoning stripping.
- [ ] Tests pass verifying Moonshot/Groq reasoning injection.
- [ ] Passthrough tests pass for Anthropic/OpenAI.

### Must Have
- Ephemeral mutation only (hook output, not session state).
- Targeted `assistant` message filtering/injection.
- Explicit delegation from Atlas to Hephaestus.

### Must NOT Have (Guardrails)
- Do NOT build an over-engineered provider registry; use simple if/switch logic.
- Do NOT modify existing transform hooks (except for registration).
- Do NOT mutate persistent session history.

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: YES
- **Framework**: bun test

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.
We will run unit tests via `bun test` and use interactive_bash to simulate an `oh-my-opencode run` call with a Cerebras model to verify the fix in the wild.

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Implementation & Testing):
├── Task 1: Delegate hook creation to Hephaestus [deep]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

### Dependency Matrix
- **1**: - - F1-F4, 1
- **FINAL**: 1 - - 4

### Agent Dispatch Summary
- **1**: **1** - T1 → `deep`
- **FINAL**: **4** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Delegate Hook Implementation to Hephaestus

  **What to do**:
  - Use the `task` tool to delegate the implementation to Hephaestus. 
  - Prompt Hephaestus to:
    1. Create `src/hooks/provider-quirks-normalizer/hook.ts`.
    2. Logic: Extract `providerID` from `messages` (e.g. `const providerID = input.session.model?.split('/')[0]` or checking `msg.info.model?.providerID`).
    3. If `providerID` is `cerebras`: iterate `assistant` messages, filter out `type: "reasoning"`. If filtering leaves `parts` empty, inject a `{ type: "text", text: "..." }` part.
    4. If `providerID` is `moonshot` or `groq`: iterate `assistant` messages that contain tool calls. If they lack a `type: "reasoning"` part, inject `{ type: "reasoning", text: "" }` (or `null` if required).
    5. Register the hook in `src/plugin/hooks/create-transform-hooks.ts`.
    6. Write `hook.test.ts` to cover Cerebras stripping, Groq injection, and Anthropic passthrough.
  - Run `bun test src/hooks/provider-quirks-normalizer/hook.test.ts`.

  **Must NOT do**:
  - Over-engineer the provider checking logic (keep it localized to this hook).
  - Mutate persistent state.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Hephaestus handles autonomous end-to-end implementation.
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F4
  - **Blocked By**: None

  **References**:
  - `src/hooks/thinking-block-validator/hook.ts` - Pattern for transform hooks iterating over message parts.
  - `src/plugin/hooks/create-transform-hooks.ts` - Registration location.

  **Acceptance Criteria**:
  - [ ] Test file created: `src/hooks/provider-quirks-normalizer/hook.test.ts`
  - [ ] `bun test src/hooks/provider-quirks-normalizer/hook.test.ts` → PASS
  - [ ] Hook registered in `create-transform-hooks.ts`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Unit Tests Pass
    Tool: Bash
    Preconditions: Implementation complete
    Steps:
      1. Run `bun test src/hooks/provider-quirks-normalizer/hook.test.ts`
    Expected Result: All tests pass (0 failures).
    Failure Indicators: Any test failures or compilation errors.
    Evidence: .sisyphus/evidence/task-1-unit-tests.txt

  Scenario: Cerebras Live Call
    Tool: interactive_bash (tmux)
    Preconditions: Oh-my-opencode CLI available locally
    Steps:
      1. Run `oh-my-opencode run "echo 'hello'" -m cerebras/llama3.1-8b`
    Expected Result: Command completes successfully without `wrong_api_format` errors.
    Failure Indicators: `invalid_request_error` or `reasoning_content is unsupported`.
    Evidence: .sisyphus/evidence/task-1-cerebras-live.txt
  ```

  **Commit**: YES
  - Message: `feat(hooks): Add providerQuirksNormalizer for Cerebras/Groq validation`
  - Files: `src/hooks/provider-quirks-normalizer/*`, `src/plugin/hooks/create-transform-hooks.ts`
  - Pre-commit: `bun run typecheck && bun test src/hooks/provider-quirks-normalizer`

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. Verify implementation exists. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `feat(hooks): Add providerQuirksNormalizer for Cerebras/Groq validation` - src/hooks/provider-quirks-normalizer/*, src/plugin/hooks/create-transform-hooks.ts

---

## Success Criteria

### Verification Commands
```bash
bun test src/hooks/provider-quirks-normalizer/hook.test.ts  # Expected: PASS
oh-my-opencode run "echo 'hello'" -m cerebras/llama3.1-8b  # Expected: Successful API call
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
