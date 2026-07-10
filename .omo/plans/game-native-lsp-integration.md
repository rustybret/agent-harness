# Game Native LSP Integration

## TL;DR
> **Quick Summary**: Add LSP configurations for game engines (Godot GDScript, Shaders) and platform-native tools (XML for Android/Jakarta, CMake for Native) to the existing LSP registry.
> 
> **Deliverables**: 
> - Updates to `server-definitions.ts` with new servers and install hints
> - Updates to `language-mappings.ts` with new extensions
> - Updates to `server-resolution.ts` for handling full filenames like `CMakeLists.txt`
> - Added tests for the new resolution paths
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → F1-F4

---

## Context

### Original Request
Integrate additional LSP specific to game development that are not yet present in the project, for either PC, mobile or console native development or with game engines like Unity, Unreal, or Godot, or with platform native tools like Xcode, android studio/gradle, or for Java and Jakarta toolchains.

### Interview Summary
**Key Discussions**:
- Unity/Unreal/Xcode/Java/Kotlin are already supported by existing LSPs (`csharp-ls`, `clangd`, `sourcekit-lsp`, `jdtls`, `kotlin-ls`).
- Missing specific support for: Godot (`opencode-godot-lsp`), Shaders (`glsl_analyzer`, `wgsl_analyzer`), XML/Jakarta/Android (`lemminx`), and Native C++ builds (`cmake-language-server`).

### Metis Review
**Identified Gaps**:
- Need to ensure `CMakeLists.txt` resolves correctly since `extname()` returns `.txt`.
- Existing tests should be updated to ensure `findServerForPath` resolves `CMakeLists.txt` to `cmake`.

---

## Work Objectives

### Core Objective
Add LSP configurations for game development and platform native tools into the built-in server definitions and language mappings.

### Concrete Deliverables
- `src/tools/lsp/server-definitions.ts` updated
- `src/tools/lsp/language-mappings.ts` updated
- `src/tools/lsp/server-resolution.ts` updated
- Related test files updated

### Definition of Done
- [x] `bun test src/tools/lsp/server-resolution.test.ts` passes
- [x] `tsc --noEmit` passes
- [x] Added servers appear in `getAllServers()`

### Must Have
- Godot (`opencode-godot-lsp`), Shaders (`glsl_analyzer`, `wgsl_analyzer`), XML (`lemminx`), and CMake (`cmake-language-server`) added to `BUILTIN_SERVERS` and `EXT_TO_LANG`.
- Path resolution for `CMakeLists.txt` explicitly handles the full filename.

### Must NOT Have (Guardrails)
- Do NOT remove any existing LSPs.
- Do NOT add MCP integrations, only LSPs.

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD
- **Framework**: bun test

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.txt`.

---

## Execution Strategy

### Parallel Execution Waves

```text
Wave 1 (Start Immediately - Implementation):
├── Task 1: Update LSP Configurations and Mappings [quick]
└── Task 2: Update Server Path Resolution and Tests [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

---

## TODOs

- [x] 1. Update LSP Configurations and Mappings

  **What to do**:
  - In `src/tools/lsp/server-definitions.ts`, add to `LSP_INSTALL_HINTS`:
    `"opencode-godot-lsp": "npm install -g opencode-godot-lsp"`
    `"glsl_analyzer": "See https://github.com/nolanderc/glsl-analyzer"`
    `"wgsl_analyzer": "cargo install wgsl_analyzer"`
    `"lemminx": "See https://github.com/eclipse/lemminx"`
    `"cmake-language-server": "pip install cmake-language-server"`
  - In `src/tools/lsp/server-definitions.ts`, add to `BUILTIN_SERVERS`:
    `gdscript: { command: ["opencode-godot-lsp", "--stdio"], extensions: [".gd", ".gdscript"] }`
    `glsl: { command: ["glsl_analyzer"], extensions: [".glsl", ".vert", ".frag", ".geom", ".tesc", ".tese", ".comp"] }`
    `wgsl: { command: ["wgsl_analyzer"], extensions: [".wgsl"] }`
    `lemminx: { command: ["lemminx"], extensions: [".xml", ".xsl"] }`
    `cmake: { command: ["cmake-language-server"], extensions: [".cmake", "CMakeLists.txt"] }`
  - In `src/tools/lsp/language-mappings.ts`, add to `EXT_TO_LANG`:
    `".gd": "gdscript"`, `".gdscript": "gdscript"`, `".glsl": "glsl"`, `".vert": "glsl"`, `".frag": "glsl"`, `".geom": "glsl"`, `".tesc": "glsl"`, `".tese": "glsl"`, `".comp": "glsl"`, `".wgsl": "wgsl"`, `".cmake": "cmake"`, `"CMakeLists.txt": "cmake"`

  **Must NOT do**:
  - Do not overwrite existing entries.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure configuration array updates.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F4
  - **Blocked By**: None

  **References**:
  - `src/tools/lsp/server-definitions.ts:BUILTIN_SERVERS` - Where to add server definitions.
  - `src/tools/lsp/language-mappings.ts:EXT_TO_LANG` - Where to map extensions.

  **Acceptance Criteria**:
  - [ ] `cat src/tools/lsp/server-definitions.ts` includes `gdscript`, `glsl`, `wgsl`, `lemminx`, `cmake`.
  - [ ] `cat src/tools/lsp/language-mappings.ts` includes mapping entries for the new extensions.
  - [ ] `cat src/tools/lsp/server-definitions.ts` includes `LSP_INSTALL_HINTS` for all newly added LSPs.

  **QA Scenarios**:
  ```
  Scenario: Verify configurations
    Tool: Bash (grep)
    Preconditions: None
    Steps:
      1. grep -q 'opencode-godot-lsp' src/tools/lsp/server-definitions.ts
      2. grep -q '"CMakeLists.txt": "cmake"' src/tools/lsp/language-mappings.ts
    Expected Result: Exit code 0
    Failure Indicators: Exit code 1
    Evidence: .sisyphus/evidence/task-1-configs.txt
  
  Scenario: Invalid syntax check
    Tool: Bash (tsc)
    Preconditions: None
    Steps:
      1. tsc --noEmit
    Expected Result: Passes without new errors
    Evidence: .sisyphus/evidence/task-1-tsc.txt
  ```

- [x] 2. Update Server Path Resolution and Tests

  **What to do**:
  - In `src/tools/lsp/server-resolution.ts`, import `basename` from `path` and update `findServerForPath(filePath)` to check `const base = basename(filePath)`. Add `if (base === "CMakeLists.txt") return findServerForExtension("CMakeLists.txt")` before the generic `extname` logic.
  - In `src/tools/lsp/server-resolution.test.ts`, add test cases for `CMakeLists.txt`, `file.gd`, and `file.xml` to ensure they resolve to the newly added servers.
  - If `findServerForExtension` doesn't find `CMakeLists.txt` because it relies on `extensions.includes(ext)`, verify `CMakeLists.txt` maps correctly. (Since we added it to `extensions` of `cmake`, it will work).

  **Must NOT do**:
  - Do not break Ansible YAML detection.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Adding a small conditional and a few unit tests.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F4
  - **Blocked By**: None

  **References**:
  - `src/tools/lsp/server-resolution.ts:findServerForPath` - Where to add `CMakeLists.txt` detection.
  - `src/tools/lsp/server-resolution.test.ts` - Where to add tests.

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/lsp/server-resolution.test.ts` passes.

  **QA Scenarios**:
  ```
  Scenario: Test resolution logic
    Tool: Bash (bun test)
    Preconditions: None
    Steps:
      1. bun test src/tools/lsp/server-resolution.test.ts
    Expected Result: Passes
    Failure Indicators: Test fails
    Evidence: .sisyphus/evidence/task-2-test.txt
    
  Scenario: Missing file fallback
    Tool: Bash (bun test)
    Preconditions: None
    Steps:
      1. Ensure unhandled file returns not_configured
    Expected Result: Passes
    Evidence: .sisyphus/evidence/task-2-fallback.txt
  ```

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": verify absence.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Verify 1:1 compliance with plan tasks. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `feat(lsp): add game dev and native tool LSP servers` - src/tools/lsp/server-definitions.ts, src/tools/lsp/language-mappings.ts
- **2**: `fix(lsp): support path resolution for specific filenames like CMakeLists.txt` - src/tools/lsp/server-resolution.ts, src/tools/lsp/server-resolution.test.ts

---

## Success Criteria

### Verification Commands
```bash
bun test src/tools/lsp/server-resolution.test.ts
tsc --noEmit
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
