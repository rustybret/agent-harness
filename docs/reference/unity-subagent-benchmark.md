# Unity Subagent Benchmark Procedure

This document defines the standard, reusable benchmark procedure for comparing the performance and reliability of the single-agent `unity-editor` (Option A) against domain-specific subagents (Option B).

## 1. Preconditions

To ensure a fair and reproducible comparison, the following preconditions must be met before starting the benchmark:

1. **Testbed Project**: Use the `webgameECS` project located at `/Volumes/Topper2TB/Git/webgameECS`.
2. **Git Clean State**: The project must be git-clean. Record the pinned commit hash in the benchmark results.
3. **SuperMCP BEAM Server**: Start the BEAM server independently **before** launching Unity:
   ```bash
   unity-bridge/Editor~/server/supermcp start
   ```
   Verify that the server is running on port `27182` and that `bridge_status` returns a healthy status.
4. **Unity Editor**: Open the Unity Editor and ensure the bridge is attached.
5. **Second Lane**: Set up a second lane on the `unity-windows-vm` instance (configured per `/Users/brethoffman/.config/opencode/skills/unity-windows-vm/SKILL.md`) with identical project state for parallel or cross-platform validation.

## 2. Fixed Task Suite

The benchmark consists of 6 tasks, one per domain. The exact same prompt wording must be sent to both Option A and Option B.

### Task 1: Scene Domain
- **Option A Dispatch**: `unity-editor` with `Domain: scene`
- **Option B Dispatch**: `unity-scene`
- **Prompt**: "Create an empty GameObject named 'BenchmarkFixture' under the parent GameObject 'Fixtures' in the active scene, and save the scene."
- **Pass Condition**: GameObject 'BenchmarkFixture' exists under 'Fixtures', and `scene_save` is called successfully.
- **Allowed Tools**: `gameobject_create`, `scene_save`, `bridge_status`, `get_relevant_tools`

### Task 2: Script-Roslyn Domain
- **Option A Dispatch**: `unity-editor` with `Domain: script-roslyn`
- **Option B Dispatch**: `unity-script-roslyn`
- **Prompt**: "Create a new MonoBehaviour script named 'BenchmarkTrigger.cs' in 'Assets/Scripts/', validate it, and verify that compilation succeeds."
- **Pass Condition**: Script is created, `script_validate` passes, and `compile_status` reports `succeeded`.
- **Allowed Tools**: `script_create`, `script_validate`, `compile_status`, `compile_errors`

### Task 3: Asset Domain
- **Option A Dispatch**: `unity-editor` with `Domain: asset`
- **Option B Dispatch**: `unity-asset`
- **Prompt**: "Create a new material named 'BenchmarkMaterial' using the 'Universal Render Pipeline/Lit' shader, and assign it to the MeshRenderer component on the GameObject 'BenchmarkFixture'."
- **Pass Condition**: Material is created and assigned to the renderer.
- **Allowed Tools**: `asset_create`, `material_set_shader`, `component_set_property`

### Task 4: Build Domain
- **Option A Dispatch**: `unity-editor` with `Domain: build`
- **Option B Dispatch**: `unity-build`
- **Prompt**: "Select WebGL as the active build target, trigger a player build, and retrieve the build report."
- **Pass Condition**: Build target is switched, build completes, and `build_get_report` returns the report.
- **Allowed Tools**: `build_select_target`, `build_invoke`, `build_get_report`

### Task 5: Runtime Domain
- **Option A Dispatch**: `unity-editor` with `Domain: runtime`
- **Option B Dispatch**: `unity-runtime`
- **Prompt**: "Enter Play Mode, wait for the scene to load, capture one profiler frame, and exit Play Mode."
- **Pass Condition**: Play Mode entered, `scene_wait_for_start` resolves, profiler frame captured, and Play Mode exited.
- **Allowed Tools**: `play_mode_enter`, `scene_wait_for_start`, `profiler_capture_frame`, `play_mode_exit`

### Task 6: Bridge-Bootstrap Domain
- **Option A Dispatch**: `unity-editor` with `Domain: bridge-bootstrap`
- **Option B Dispatch**: `unity-bridge-bootstrap`
- **Prompt**: "Perform a full bridge health check, verify modal state, and create a project checkpoint labeled 'PreBenchmark'."
- **Pass Condition**: `bridge_status` is healthy, no modals are blocking, and `checkpoint_create` completes.
- **Allowed Tools**: `bridge_status`, `list_pending_modals`, `checkpoint_create`, `checkpoint_status`

## 3. Protocol

For each task in the suite, follow this protocol:

1. **Option A Run**:
   - Dispatch the `unity-editor` agent.
   - Include the `Domain:` line in the prompt.
   - Record all metrics.
2. **Reset**:
   - Run `git reset --hard` and `git clean -fd` to restore the testbed to the clean pinned commit.
3. **Option B Run**:
   - Dispatch the matching domain-specific agent (e.g., `unity-scene`).
   - Record all metrics.
4. **Model Consistency**: Use the exact same model chain for both lanes.

## 4. Metrics

Record the following metrics for every run:

- **Wall-clock Time**: Total time from dispatch to the final Status line.
- **Turn Count**: Number of turns taken by the agent.
- **Tool-call Count**: Total number of tool calls executed.
- **Tokens**: Input and output tokens if surfaced by the harness.
- **Status Outcome**: The final status (`done`, `blocked`, or `needs-decision`).
- **Violation Count**: Number of denied-tool attempts or attempts to load a second domain skill.

## 5. Winner Criteria

- **Task Win**: A lane wins a task if it achieves `Status: done` correctly, with fewer tool calls, and zero violations.
- **Overall Winner**: The option with the most task wins.
- **Tie Breaker**: In case of a tie, the option with the lower total wall-clock time across all tasks wins.

## 6. Results Template

Record the results under the following directory structure:
`.omo/evidence/<date>-unity-ab-bench/<task>/<option>/`

### Summary Table

| Task | Option A (unity-editor) Status | Option A Tool Calls | Option A Violations | Option B (Domain Agent) Status | Option B Tool Calls | Option B Violations | Winner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Scene | | | | | | | |
| 2. Script | | | | | | | |
| 3. Asset | | | | | | | |
| 4. Build | | | | | | | |
| 5. Runtime | | | | | | | |
| 6. Bootstrap | | | | | | | |

## 7. Gate

This benchmark procedure is gated. It must run ONLY on explicit user go-ahead with a live editor and real spend. Do not run this procedure automatically.
