# Built-in Subagent Output Export Command

## TL;DR

> **Quick Summary**: Add a manual built-in slash command, default name `/export-subagent-output`, that exports the current session's completed subagent/background-task outputs from session history into Markdown files under `.sisyphus/subagent-output`.
>
> **Deliverables**:
> - Built-in command definition and template
> - Bun tests for registration, template content, and edge-case instructions
> - Verified command guidance for safe filenames and missing transcript fallback
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 implementation waves plus final verification
> **Critical Path**: T1 → T2/T3/T4 → T6 → T8 → Final Verification

---

## Context

### Original Request
Create a built-in slash command in this agent-harness / oh-my-openagent fork that exports transcripts of this session's completed subagent tasks into Markdown files in `.sisyphus/subagent-output`. Files should represent sequential sets of subtasks, the agent/category that produced them, and the content in the document. Later, after validating this manual command, automatic configurable export by subagent type/name may be added.

### Interview Summary
**Key Discussions**:
- V1 is manual only, current session only.
- Output granularity is one Markdown file per completed subagent/background task.
- Filename pattern is `#-spawnevent-subagent-contentslug.md`.
- The command should rely on session history for now; later live-child-task hooks are future scope.
- Automated tests should be added after implementation.

**Research Findings**:
- Built-in commands are `CommandDefinition` objects in `src/features/builtin-commands/commands.ts`.
- Command templates live under `src/features/builtin-commands/templates/`.
- Built-in command names are typed in `src/features/builtin-commands/types.ts` and tested in `src/features/builtin-commands/commands.test.ts`.
- Background task metadata includes task ID, parent session ID, child session ID, agent, category, status, prompt, result, and attempts.
- Full live task payloads can expire; session-history export must be explicit about fallback behavior.

### Metis Review
**Identified Gaps** (addressed):
- Command name was unspecified: defaulted to `/export-subagent-output` and listed as overrideable before implementation.
- “Completed” was ambiguous: defaulted to successful completed tasks only for v1.
- Overwrite behavior was unspecified: require deterministic unique filenames and no silent overwrites.
- Hidden/internal content handling was unspecified: require excluding internal markers and not fabricating missing transcript content.

---

## Work Objectives

### Core Objective
Provide a built-in slash command that lets a user export recoverable current-session completed subagent/background-task outputs into durable Markdown files without relying on still-live background task handles.

### Concrete Deliverables
- `src/features/builtin-commands/templates/export-subagent-output.ts`
- `src/features/builtin-commands/types.ts` updated with the new command name
- `src/features/builtin-commands/commands.ts` updated to register `/export-subagent-output`
- `src/config/schema/commands.ts` updated so `disabled_commands` accepts the new built-in command name
- Tests in `src/features/builtin-commands/commands.test.ts` and/or a focused template test

### Definition of Done
- [ ] `/export-subagent-output` is available as a built-in command unless disabled.
- [ ] Command template instructs the executing agent to export current-session completed subagent/background-task outputs from session history.
- [ ] Template requires files under `.sisyphus/subagent-output` with safe `#-spawnevent-subagent-contentslug.md` filenames.
- [ ] Tests pass for command registration and template requirements.
- [ ] `bun run typecheck`, `bun run build`, and relevant Bun tests pass.

### Must Have
- Current-session-only behavior.
- Completed-subagent/background-task-only behavior.
- Session-history based export and recovery notes when full transcript data is missing.
- One Markdown file per completed subagent/background task.
- Deterministic ordering and safe filename normalization.

### Must NOT Have (Guardrails)
- No automatic hook/config-driven export in v1.
- No all-session or historical-session scanning.
- No running/pending task export.
- No live task handle dependency as the only path.
- No new config schema fields.
- No CLI command.
- No JSON/HTML/PDF export formats.
- No fabricated transcript content.
- No path traversal or writes outside `.sisyphus/subagent-output`.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after
- **Framework**: Bun test
- **If TDD**: Not selected

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation, can start immediately):
├── Task 1: Register command type and definition [quick]
├── Task 2: Draft command template structure [quick]
├── Task 3: Define export algorithm and Markdown schema in template [quick]
├── Task 4: Define filename normalization and fallback rules in template [quick]
└── Task 5: Add command registration tests [quick]

Wave 2 (After Wave 1):
├── Task 6: Add template behavior tests [quick]
├── Task 7: Add edge-case/fallback tests [quick]
└── Task 8: Run focused validation and tighten command wording [quick]

Wave FINAL (After ALL tasks):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
```

### Dependency Matrix

- **1**: depends on none; blocks 5, 8
- **2**: depends on none; blocks 3, 4, 6, 8
- **3**: depends on 2; blocks 6, 7, 8
- **4**: depends on 2; blocks 6, 7, 8
- **5**: depends on 1; blocks 8
- **6**: depends on 2, 3, 4; blocks 8
- **7**: depends on 3, 4; blocks 8
- **8**: depends on 1-7; blocks final verification

### Agent Dispatch Summary
- **Wave 1**: 5 quick agents for T1-T5
- **Wave 2**: 3 quick agents for T6-T8
- **FINAL**: oracle, unspecified-high, unspecified-high, deep

---

## TODOs

- [x] 1. Register the built-in command name and definition

  **What to do**:
  - Add `export-subagent-output` to the built-in command name type.
  - Register the command in the built-in command definitions with description, `argumentHint`, and template import.
  - Add `export-subagent-output` to `BuiltinCommandNameSchema` so config validation and `disabled_commands` remain compatible.
  - Default command name: `/export-subagent-output`.

  **Must NOT do**:
  - Do not add config fields or automatic hooks.
  - Do not add a CLI command.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small typed registration change in the built-in command module.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: `git-master` - no git history operation needed.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5, 8
  - **Blocked By**: None

  **References**:
  - `src/features/builtin-commands/types.ts` - Built-in command name union/type.
  - `src/features/builtin-commands/commands.ts` - Command definition registration pattern.
  - `src/config/schema/commands.ts` - Built-in command name schema used by config validation.
  - `src/features/builtin-commands/templates/` - Existing template import/export pattern.

  **Acceptance Criteria**:
  - [ ] Command type includes `export-subagent-output`.
  - [ ] Built-in command definition exists with description and argument hint.
  - [ ] `BuiltinCommandNameSchema` includes `export-subagent-output`.
  - [ ] Command template is imported without circular dependencies.

  **QA Scenarios**:
  ```
  Scenario: Command appears in built-in definitions
    Tool: Bash
    Preconditions: Repository checkout with implementation complete
    Steps:
      1. Run `bun test src/features/builtin-commands/commands.test.ts --test-name-pattern "export-subagent-output"`
      2. Assert exit code is 0
      3. Assert output contains no failing tests
    Expected Result: Focused command registration test passes
    Failure Indicators: Missing command, TypeScript compile failure, or failing assertion
    Evidence: .sisyphus/evidence/task-1-command-registration.txt

  Scenario: Disabled commands still work
    Tool: Bash
    Preconditions: Test added for disabling `export-subagent-output`
    Steps:
      1. Run `bun test src/features/builtin-commands/commands.test.ts --test-name-pattern "disabled"`
      2. Assert exit code is 0
    Expected Result: The command can be filtered like other built-ins
    Evidence: .sisyphus/evidence/task-1-disabled-command.txt
  ```

  **Commit**: YES
  - Message: `feat(commands): register subagent output export command`
  - Files: `src/features/builtin-commands/types.ts`, `src/features/builtin-commands/commands.ts`, `src/config/schema/commands.ts`
  - Pre-commit: `bun test src/features/builtin-commands/commands.test.ts`

- [x] 2. Add the command template shell

  **What to do**:
  - Create the built-in command template file.
  - Use established `<command-instruction>` and `<user-request>$ARGUMENTS</user-request>` style.
  - Include `$SESSION_ID` so the command is scoped to the active session.

  **Must NOT do**:
  - Do not instruct the agent to scan all sessions.
  - Do not mention future automatic hook behavior as part of v1 execution.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Template-only command scaffolding.
  - **Skills**: []
  - **Skills Evaluated but Omitted**: `writing` - command text is technical and bounded.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 3, 4, 6, 8
  - **Blocked By**: None

  **References**:
  - `src/features/builtin-commands/templates/handoff.ts` - Existing command template style for session/context summarization.
  - `src/features/builtin-commands/commands.ts` - How templates are wrapped in command definitions.

  **Acceptance Criteria**:
  - [ ] Template file exports a named constant.
  - [ ] Template includes current-session-only language and `$SESSION_ID`.
  - [ ] Template instructs output path `.sisyphus/subagent-output`.

  **QA Scenarios**:
  ```
  Scenario: Template contains required session/output instructions
    Tool: Bash
    Preconditions: Template test exists
    Steps:
      1. Run `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts`
      2. Assert test verifies `$SESSION_ID` and `.sisyphus/subagent-output`
    Expected Result: Template test passes
    Evidence: .sisyphus/evidence/task-2-template-shell.txt

  Scenario: Template excludes out-of-scope modes
    Tool: Bash
    Preconditions: Template test includes negative assertions or explicit guardrail assertions
    Steps:
      1. Run the template test file
      2. Assert template contains guardrails against all-session export and automatic hooks
    Expected Result: Guardrail assertions pass
    Evidence: .sisyphus/evidence/task-2-template-guardrails.txt
  ```

  **Commit**: YES
  - Message: `feat(commands): add subagent export template shell`
  - Files: `src/features/builtin-commands/templates/export-subagent-output.ts`
  - Pre-commit: `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts`

- [x] 3. Specify the session-history export algorithm in the template

  **What to do**:
  - Instruct the executing agent to inspect the current session history for completed background/subagent task notifications and recoverable outputs.
  - Require direct child tasks of the current session only.
  - Define Markdown sections: title, source session, task ID if known, spawn event, agent/category, request summary, transcript/recovered content, limitations.
  - Require recovery notes for incomplete session-history evidence instead of invented content.

  **Must NOT do**:
  - Do not require live `background_output` handles for success.
  - Do not fabricate missing transcript text.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Bounded command-template algorithm text.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES, after Task 2 starts or completes
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6, 7, 8
  - **Blocked By**: Task 2

  **References**:
  - `src/features/background-agent/types.ts` - Task metadata fields to mention when available.
  - `src/features/background-agent/task-history.ts` - Recent task history concept and limitations.
  - `src/tools/background-task/full-session-format.ts` - Existing full-session formatting precedent.

  **Acceptance Criteria**:
  - [ ] Template says current session only.
  - [ ] Template says completed tasks only.
  - [ ] Template describes recovery note behavior for missing transcript content.
  - [ ] Template excludes internal-only markers such as `OMO_INTERNAL_INITIATOR`.

  **QA Scenarios**:
  ```
  Scenario: Happy path export instructions are complete
    Tool: Bash
    Preconditions: Template behavior test exists
    Steps:
      1. Run `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts --test-name-pattern "export algorithm"`
      2. Assert checks for current session, completed tasks, Markdown sections, and output directory
    Expected Result: Export algorithm assertions pass
    Evidence: .sisyphus/evidence/task-3-export-algorithm.txt

  Scenario: Missing transcript fallback is explicit
    Tool: Bash
    Preconditions: Template test includes fallback assertions
    Steps:
      1. Run the fallback-focused template test
      2. Assert template contains a clear recovery/limitation requirement
    Expected Result: Missing transcript path is covered by command instructions
    Evidence: .sisyphus/evidence/task-3-missing-transcript-fallback.txt
  ```

  **Commit**: YES
  - Message: `feat(commands): define session history export flow`
  - Files: `src/features/builtin-commands/templates/export-subagent-output.ts`
  - Pre-commit: `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts`

- [x] 4. Define safe filename generation and collision behavior

  **What to do**:
  - Encode user-confirmed pattern `#-spawnevent-subagent-contentslug.md`.
  - Define `#` as the sequential subagent-view task number when available, with stable session-message-order fallback.
  - Require lowercase filesystem-safe slugs, removal of path traversal characters, max length, and deterministic collision suffixes.
  - Require no silent overwrites.

  **Must NOT do**:
  - Do not allow `/`, `..`, null bytes, or absolute paths in generated filenames.
  - Do not write outside `.sisyphus/subagent-output`.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Template rule definition and testable string requirements.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES, after Task 2 starts or completes
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 6, 7, 8
  - **Blocked By**: Task 2

  **References**:
  - `src/features/builtin-commands/templates/` - Command text style for procedural safety rules.
  - `.sisyphus/subagent-output/README.md` - Existing manual archive precedent and recovery-note wording.

  **Acceptance Criteria**:
  - [ ] Template includes exact filename pattern.
  - [ ] Template requires safe slug normalization.
  - [ ] Template requires deterministic collision handling.
  - [ ] Template forbids writes outside `.sisyphus/subagent-output`.

  **QA Scenarios**:
  ```
  Scenario: Unsafe filename characters are addressed
    Tool: Bash
    Preconditions: Filename rule test exists
    Steps:
      1. Run template tests for filename requirements
      2. Assert test checks for path traversal prevention and slug normalization wording
    Expected Result: Filename safety requirements are present
    Evidence: .sisyphus/evidence/task-4-filename-safety.txt

  Scenario: Duplicate slug handling is addressed
    Tool: Bash
    Preconditions: Template test includes duplicate/collision assertion
    Steps:
      1. Run template tests
      2. Assert command template requires deterministic suffixes for duplicate filenames
    Expected Result: Duplicate export names cannot silently overwrite
    Evidence: .sisyphus/evidence/task-4-duplicate-filenames.txt
  ```

  **Commit**: YES
  - Message: `feat(commands): document safe export filenames`
  - Files: `src/features/builtin-commands/templates/export-subagent-output.ts`
  - Pre-commit: `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts`

- [x] 5. Add command registration tests

  **What to do**:
  - Extend built-in command tests to assert the command loads by default.
  - Assert it can be disabled using existing disabled-command behavior.
  - Assert the command template includes `$ARGUMENTS` if the wrapping pattern requires it.

  **Must NOT do**:
  - Do not mock external APIs.
  - Do not create brittle tests tied to unrelated command ordering.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused Bun tests following existing command test patterns.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 8
  - **Blocked By**: Task 1

  **References**:
  - `src/features/builtin-commands/commands.test.ts` - Existing command load/disable tests.
  - `test-setup.ts` - Global test reset behavior.

  **Acceptance Criteria**:
  - [ ] New command load test passes.
  - [ ] New command disable test passes.
  - [ ] No existing built-in command tests regress.

  **QA Scenarios**:
  ```
  Scenario: Registration tests pass
    Tool: Bash
    Preconditions: Tests implemented
    Steps:
      1. Run `bun test src/features/builtin-commands/commands.test.ts`
      2. Assert exit code is 0
    Expected Result: All built-in command tests pass
    Evidence: .sisyphus/evidence/task-5-command-tests.txt

  Scenario: Typecheck catches no registration issues
    Tool: Bash
    Preconditions: Registration tests pass
    Steps:
      1. Run `bun run typecheck`
      2. Assert exit code is 0
    Expected Result: TypeScript accepts the new command definition
    Evidence: .sisyphus/evidence/task-5-typecheck.txt
  ```

  **Commit**: YES
  - Message: `test(commands): cover subagent export registration`
  - Files: `src/features/builtin-commands/commands.test.ts`
  - Pre-commit: `bun test src/features/builtin-commands/commands.test.ts`

- [x] 6. Add template behavior tests

  **What to do**:
  - Create a focused template test file or extend existing command tests.
  - Assert required phrases and constraints are present: output directory, current session, completed tasks, filename convention, recovery notes, internal marker exclusion.
  - Keep tests robust by checking semantic anchor phrases rather than the whole template body.

  **Must NOT do**:
  - Do not snapshot the entire template.
  - Do not require manual review.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused tests after template implementation.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 2, 3, 4

  **References**:
  - `src/features/builtin-commands/templates/*.test.ts` - Template testing pattern if present.
  - `src/features/builtin-commands/commands.test.ts` - Existing assertions for template content.

  **Acceptance Criteria**:
  - [ ] Template tests pass.
  - [ ] Tests cover both happy-path instructions and missing-output fallback instructions.

  **QA Scenarios**:
  ```
  Scenario: Template behavior tests pass
    Tool: Bash
    Preconditions: Template tests implemented
    Steps:
      1. Run `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts`
      2. Assert exit code is 0
    Expected Result: All template behavior assertions pass
    Evidence: .sisyphus/evidence/task-6-template-tests.txt

  Scenario: Template does not drift into future-scope automation
    Tool: Bash
    Preconditions: Template tests include future-scope guardrails
    Steps:
      1. Run template tests
      2. Assert tests require explicit no-hook/no-config wording
    Expected Result: V1 remains manual-only
    Evidence: .sisyphus/evidence/task-6-future-scope-guardrails.txt
  ```

  **Commit**: YES
  - Message: `test(commands): cover subagent export template behavior`
  - Files: `src/features/builtin-commands/templates/export-subagent-output.test.ts`
  - Pre-commit: `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts`

- [x] 7. Add edge-case and fallback coverage

  **What to do**:
  - Ensure tests or template assertions cover no completed tasks, duplicate filenames, missing transcript/session-history evidence, unsafe characters, and missing agent/category.
  - If no executable helper exists, assert the command template instructs the executing agent how to handle each edge case.

  **Must NOT do**:
  - Do not add large runtime helpers unless needed by the command system.
  - Do not change background-agent retention/lifecycle behavior.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused test coverage and wording tightening.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 3, 4

  **References**:
  - `src/features/background-agent/task-history.test.ts` - Precedent for history/fallback behavior tests.
  - `src/tools/background-task/full-session-format.ts` - Formatting edge cases for full-session output.

  **Acceptance Criteria**:
  - [ ] Edge cases are covered by tests or explicit template assertions.
  - [ ] Missing transcript output is a warning/recovery note, not fabricated content.
  - [ ] Unsafe filenames are forbidden by template requirements.

  **QA Scenarios**:
  ```
  Scenario: Missing and no-task cases are covered
    Tool: Bash
    Preconditions: Edge-case tests implemented
    Steps:
      1. Run `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts --test-name-pattern "fallback|no completed"`
      2. Assert exit code is 0
    Expected Result: No completed tasks and missing transcript instructions are tested
    Evidence: .sisyphus/evidence/task-7-missing-and-empty.txt

  Scenario: Unsafe and duplicate filenames are covered
    Tool: Bash
    Preconditions: Edge-case tests implemented
    Steps:
      1. Run filename-focused tests
      2. Assert collision suffix and path safety instructions are present
    Expected Result: Filename edge cases are tested
    Evidence: .sisyphus/evidence/task-7-filename-edge-cases.txt
  ```

  **Commit**: YES
  - Message: `test(commands): cover subagent export edge cases`
  - Files: `src/features/builtin-commands/templates/export-subagent-output.test.ts`
  - Pre-commit: `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts`

- [x] 8. Run focused validation and tighten command wording

  **What to do**:
  - Run relevant command/template tests, typecheck, and build.
  - Review command text for clarity and absence of AI-slop wording.
  - Ensure future auto-export TODO is mentioned only as future scope, not implemented behavior.

  **Must NOT do**:
  - Do not commit unrelated formatting churn.
  - Do not broaden scope to live hooks or config.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Validation and final wording pass.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 final integration
  - **Blocks**: Final verification
  - **Blocked By**: Tasks 1-7

  **References**:
  - `AGENTS.md` - Bun-only, no AI-slop, test and naming conventions.
  - `.github/workflows/ci.yml` - CI validation expectations.
  - `script/run-ci-tests.ts` - CI test runner.

  **Acceptance Criteria**:
  - [ ] `bun test src/features/builtin-commands/commands.test.ts` passes.
  - [ ] New template tests pass.
  - [ ] `bun run typecheck` passes.
  - [ ] `bun run build` passes.

  **QA Scenarios**:
  ```
  Scenario: Full focused validation passes
    Tool: Bash
    Preconditions: Tasks 1-7 complete
    Steps:
      1. Run `bun test src/features/builtin-commands/commands.test.ts`
      2. Run `bun test src/features/builtin-commands/templates/export-subagent-output.test.ts`
      3. Run `bun run typecheck`
      4. Run `bun run build`
    Expected Result: All commands exit 0
    Evidence: .sisyphus/evidence/task-8-focused-validation.txt

  Scenario: Command remains manual current-session v1
    Tool: Bash
    Preconditions: Validation commands pass
    Steps:
      1. Search changed command/template files for `automatic`, `all sessions`, `config schema`, and `hook`
      2. Assert any occurrences are only in explicit future-scope/guardrail text
    Expected Result: No implemented automatic or all-session behavior is introduced
    Evidence: .sisyphus/evidence/task-8-scope-review.txt
  ```

  **Commit**: YES
  - Message: `feat(commands): validate subagent output export command`
  - Files: changed command and test files
  - Pre-commit: `bun test src/features/builtin-commands/commands.test.ts && bun run typecheck`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [x] F1. **Plan Compliance Audit** — `oracle`
- [x] F2. **Code Quality Review** — `unspecified-high`
- [x] F3. **Real Manual QA** — `unspecified-high`
- [x] F4. **Scope Fidelity Check** — `deep`
  Compare git diff to plan. Confirm no config schema, background lifecycle, CLI, automatic hooks, or non-Markdown formats were added.
  Output: `Tasks [N/N compliant] | Scope creep [none/issues] | VERDICT`

---

## Commit Strategy

- **1**: `feat(commands): register subagent output export command` - command type/definition/template shell
- **2**: `feat(commands): define subagent output export behavior` - template algorithm and filename/fallback rules
- **3**: `test(commands): cover subagent output export command` - registration/template/edge-case tests
- **4**: `chore(commands): validate subagent output export command` - final cleanup if needed

---

## Success Criteria

### Verification Commands
```bash
bun test src/features/builtin-commands/commands.test.ts
bun test src/features/builtin-commands/templates/export-subagent-output.test.ts
bun run typecheck
bun run build
```

### Final Checklist
- [x] `/export-subagent-output` built-in command exists.
- [x] V1 is current-session-only and manual-only.
- [x] Export target is `.sisyphus/subagent-output`.
- [x] Filename convention is `#-spawnevent-subagent-contentslug.md` with safe normalization.
- [x] Missing transcript/session-history gaps produce explicit recovery notes.
- [x] No automatic hook/config behavior added.
