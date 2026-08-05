# Unity Subagent Benchmark Procedure

This document defines the standard, reusable benchmark procedure for comparing the performance and reliability of the single-agent `unity-editor` (Option A) against domain-specific subagents (Option B).

## 1. Preconditions

To ensure a fair and reproducible comparison, and to keep the benchmark from ever touching
an in-flight development worktree, the following preconditions must be met before starting
the benchmark:

1. **Testbed Project**: Clone `webgameECS` fresh to a disposable path (e.g. `/tmp/webgameECS-bench-<date>`)
   pinned at a known commit. **Never run this benchmark against the live worktree at
   `/Volumes/Topper2TB/Git/webgameECS`** — that path routinely has in-flight work (uncommitted
   ECS runtime changes, untracked evidence) that a `git reset --hard && git clean -fd` would
   destroy irrecoverably. The Unity project root inside the clone is `webgameECS/UnityProject/`,
   not the repo root — point the Editor and the bridge at that subdirectory.
2. **Git Clean State**: The disposable clone must be git-clean at the pinned commit. Record the
   pinned commit hash in the benchmark results.
3. **SuperMCP BEAM Server**: Start the BEAM server independently **before** launching Unity, with
   the transport explicit:
   ```bash
   SUPERMCP_TRANSPORT=http unity-bridge/Editor~/server/supermcp start
   ```
   The binary defaults to `stdio` transport, which binds no listener — a stdio-mode boot looks
   identical to a failed boot if you only probe the port. `SUPERMCP_TRANSPORT=http` (or
   `http_and_stdio`) is required for the port check below to be meaningful. If the Unity C#
   bootstrap instead auto-spawns the server (it sets `http_and_stdio` by default), do not also
   start one manually — the second bind fails with `eaddrinuse`.
   Verify that the server is running on port `27182` and that `bridge_status` returns a healthy status.
4. **Unity Editor**: Open the Unity Editor on `webgameECS/UnityProject/` in the disposable clone
   and ensure the bridge is attached.
5. **Second Lane**: Set up a second lane on the `unity-windows-vm` instance (configured per
   `/Users/brethoffman/.config/opencode/skills/unity-windows-vm/SKILL.md`) with an identical
   disposable clone at the same pinned commit for parallel or cross-platform validation. The
   guest must be reachable over the WireGuard mesh before this lane can run — re-establish the
   relay if the guest IP is not currently routable.

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
- **Allowed Tools**: `material_create`, `material_assign`, `component_set_property`
- **Note**: The shader is set via `material_create`'s `shader` param (required `["path"]`,
  optional `shader`/`properties`) — there is no separate set-shader call. Assignment uses
  `material_assign` (required `["gameObjectPath", "materialPath"]`, optional `slot`).

### Task 4: Build Domain
- **Option A Dispatch**: `unity-editor` with `Domain: build`
- **Option B Dispatch**: `unity-build`
- **Prompt**: "Select WebGL as the active build target, then retrieve the most recent build report."
- **Pass Condition**: Build target is switched to WebGL, and `build_get_report` returns a report.
- **Allowed Tools**: `build_select_target`, `build_get_report`
- **Note**: `build_invoke` is intentionally excluded. It calls `BuildPipeline.BuildPlayer`
  synchronously on the Unity main thread and a WebGL player build takes minutes, while the
  bridge's end-to-end response timeout is a fixed 30s ceiling on both the Elixir proxy side
  (`bridge_proxy.ex` `@default_timeout 30_000`) and the C# handler side (`ResponseTimeoutSeconds
  = 30`). Both lanes would time out identically at 30s, which measures the known bridge
  constraint rather than anything that discriminates Option A from Option B. Seed the testbed
  with one pre-existing build report before running this task so `build_get_report` has
  something to retrieve — target switching and report retrieval both return well inside 30s.

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
   - Run `git reset --hard` and `git clean -fd` **inside the disposable clone only** to restore
     it to the clean pinned commit. Never run this against `/Volumes/Topper2TB/Git/webgameECS`
     or any other live development worktree.
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
