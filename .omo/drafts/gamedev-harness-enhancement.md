# Draft: Game-Dev-Purposed agent-harness + cloudhome Integration

## Original Request
Enhance the agent-harness fork to be purpose-built for game development, enabling
ultrawork-style headless automated development, integrated with the cloudhome K8s
cluster. User's explicit pain point: knowing where to break work down —
hook vs tool vs subagent vs primary agent. User wants to be interviewed
("ask me anything about capabilities and functionalities").

## Context Gathered (cloudhome)
- Platform: OpenTofu (OCI) + Ansible (host bootstrap) + K3s runtime, operator `just` recipes.
- Nodes: sj-a-edge-01 (control/edge), sj-b-worker-01 (workloads), altos-worker-01 (home ZFS NAS, 13.7TB), phx-dr-01 (DR).
- **Game-relevant services already live**:
  - **Nakama** game server backend (+ PostgreSQL) for **webgameECS** — multiplayer/game state. Console at nakama-console.rustybret.com. `ops/nakama.just` (deploy/status/logs/console/build/build-rollout).
  - **In-cluster BuildKit** (amd64 on altos + arm64 on sj-b) + build-dispatcher (GitHub webhook → K8s build Jobs). `ops/buildkit.just`. Repo→image map in docker/build-dispatcher/src/repo-map.js.
  - **OpenCode** already deployed in-cluster (code.rustybret.com), OIDC via Authentik. `ops/opencode.just` (build/deploy/rollout). Anthropic relay via Cloudflare Worker.
  - OCIR registry, OCI Vault + ESO secrets, ZFS local-altos StorageClass.
- Conventions: code-over-clickops, `just` recipes preferred, rebuild-from-code, one tofu state per tenancy.

## Context Gathered (agent-harness = omo fork)
- 11 agents (Sisyphus/Atlas/Hephaestus/Prometheus + subagents Oracle/Librarian/Explore/Metis/Momus/Multimodal-Looker/Sisyphus-Junior).
- 54+ hooks (Session/ToolGuard/Transform/Continuation/Skill tiers), 20-39 tools, 3-tier MCP, skills, team-mode.
- Earlier fork work added LSP servers for gdscript/glsl/wgsl/cmake (game-dev languages) → Godot signal.
- Fork now on two-branch model (dev mirror + fork/local), syncs from upstream weekly.

## Game-Dev Signals (to confirm in interview)
- webgameECS: web-based ECS game (likely TS/WASM) with Nakama netcode backend.
- Possible Godot usage (gdscript/glsl LSP work).
- Headless automated dev = the build→run→observe→fix loop without a human.

## Decomposition Framework (delivered to user)
[recorded below — see "Extension Point Decision Framework"]

## Open Questions (interview)
- Q1 engine/framework (webgameECS stack? Godot? both?)
- Q2 what "headless automated development" means concretely (the loop)
- Q3 cloudhome's role (run agent in-cluster? in-cluster game builds? deploy previews? Nakama integration tests?)
- Q4 how an agent VERIFIES the game works headlessly (screenshots? deterministic sim? automated playtest?)
- Q5 biggest current pain point in the loop

## Interview Round 1 Answers (CONFIRMED)
- **Engines (scope = ALL)**: Godot, Unity, Unreal, Roblox Studio, + Xcode, + backend/dev tooling. Multi-engine agent OS, not single-engine.
- **Verification model (THE crux)**: agents make changes + read/write INSIDE game-dev apps (Unity Editor, Xcode, Godot, etc.) via MCP or CLI, WITHOUT a human clicking buttons / configuring menus. Core capability = programmatic editor/engine control surfaces.
- **Cloudhome role**: (a) run heavy builds via BuildKit dispatcher, (b) run the agent headless in-cluster.
- **Primary pain**: context / orchestration overhead → decomposition quality is the real lever.

## Key Architectural Tensions (to resolve)
- **GUI-bound vs headless-in-cluster**: Godot (--headless), Unity (-batchmode), Unreal (commandlets/Python) run headless in K8s. BUT Roblox Studio + full Unity/Unreal *Editor* GUIs are not K8s-friendly. Reconciliation needed: hybrid runner model (CLI engines in-cluster; GUI engines on a local/VM/macOS runner). Xcode = macOS-only (xcodebuild CLI + needs a Mac runner; altos is Linux, sj nodes are OCI Linux).
- **Build vs integrate existing MCPs**: community MCPs exist (Unity-MCP, Godot-MCP, Blender-MCP, Unreal-MCP, Roblox Open Cloud). Wrap/orchestrate vs build omo-native unified layer.
- **Unified abstraction**: one common verb set (open_project, edit_asset, run_headless, build, test, capture) with per-engine adapters vs per-engine bespoke tools.

## Decomposition Framework (DELIVERED)
Two axes: WHO triggers + does it THINK (LLM).
- Hook = involuntary reflex on lifecycle event (auto-build-on-edit, broken-build guard).
- Tool = deterministic verb, structured I/O (headless_run, capture_frame, engine RPC).
- Subagent = isolated reasoning + parallelism (playtest-analyzer w/ vision, netcode-tester).
- Primary agent = persistent driver identity (Atlas/Sisyphus already are this — rarely add new).
- Skill = bundles a repeatable workflow wiring the above into ultrawork.
90% answer = tools + hooks; subagents for isolation/parallelism; skills to package; almost never a new primary agent.

## MAJOR REFRAME (Interview Round 2 — SuperMCP already exists)
The control layer is NOT to be built from scratch in agent-harness. It already exists / is planned as the **SuperMCP** family, and the real goal is to EXTEND the SuperMCP concept + the Elixir/BEAM app across all engines, then WIRE it into the omo fork for headless ultrawork.

### Unity SuperMCP (`/Volumes/Topper2TB/Git/unitySuperMCP`) — BUILT
- Elixir/BEAM MCP server + C# Unity Editor plugin (UPM `com.supermcp.unity-bridge`).
- Synthesizes 5 upstreams (coplay, ivanmurzak, codergamester, isuzu, glade). 235+ tools.
- Agent-tuning layer: unified envelope, idempotency (safe/unsafe), pagination, atomic batch_execute + rollback, get_relevant_tools (128-tool-cap meta-tool), session memory, semantic script search, skills auto-gen, screenshots, reflection (any C# method), Roslyn validation.
- **Topology**: C# Editor plugin starts HTTP listener (ports 27182-27199), UDP multi-editor discovery, SessionState domain-reload resilience. MCP server talks to bridge over HTTP (stdio + streamable HTTP transports).
- Ships 9 skills (unity-editor, script-execute, reflection-*, screenshot, asset-pipeline, etc.).
- **CRITICAL CONSTRAINT**: most tools require the **Unity Editor running** (GUI). batchmode/CI is supported (ivanmurzak CI/CD + Docker) but the rich editor surface needs a live Editor → desktop/Mac/Windows runner, NOT pure K8s.

### Roblox SuperMCP (`/Volumes/Topper2TB/Git/job-world/docs/roblox-supermcp-strategy.md`) — STRATEGY ONLY, no code
- Agent-layer PROXY over the first-party `StudioMCP` stdio binary + Boshy plugin (Roblox plugins are sandboxed to HttpService, cannot spawn processes → SuperMCP's child-process topology does NOT port).
- Inherits first-party agent primitives (explore_subagent = context pruning, playtest_subagent, screen_capture, input sim, asset gen, multi-studio).
- Builds the safety net: batch+rollback, unified envelope, Luau pre-flight validation, role-filtering/get_relevant_tools, modal handling, upstream-availability fallback.
- Open Q (their doc §5): server runtime Elixir vs TS; secondary upstream Boshy vs Conduit vs Weppy; bridge transport; official-server headless activation is UI-gated (autonomy tension).

### The unifying goal
Generalize the SuperMCP pattern (agent-tuning layer + per-engine adapter/bridge) from Unity-only to ALL engines (Godot, Unity, Unreal, Roblox, +Xcode/backend tooling), and consume it from the omo agent-harness fork via hooks/tools/subagents/skills/MCP to drive headless ultrawork game dev.

## cloudhome integration facts (confirmed from AGENTS.md)
- Nakama game backend (+PostgreSQL) for webgameECS; `ops/nakama.just`.
- In-cluster BuildKit: amd64 (altos) + arm64 (sj-b) + build-dispatcher (GitHub webhook → K8s build Jobs); repo→image map in docker/build-dispatcher/src/repo-map.js; `ops/buildkit.just trigger`.
- OpenCode deployed in-cluster (code.rustybret.com), OIDC via Authentik; `ops/opencode.just`.
- OCIR registry, OCI Vault + ESO secrets, ZFS local-altos StorageClass.
- Hard conventions: code-over-clickops, `just` recipes preferred, rebuild-from-code, one tofu state per tenancy, NO GPU scheduling in v1 (anti-pattern), keep WireGuard/cloudflared OUT of K8s.
- **Tension**: cloudhome explicitly says "no GPU scheduling in v1" — Editor/render-heavy game automation in-cluster may collide with this. Builds (batchmode, CLI) fit BuildKit; live-Editor automation likely needs the Mac/Windows runner.

## THE LAYER MODEL (emerging architecture)
- **L1 Engine control** = SuperMCP family (Elixir/BEAM agent-tuning core + per-engine bridge/proxy). Lives in its own repo(s), NOT in agent-harness.
- **L2 Orchestration** = omo agent-harness fork: tier-3 skill-embedded MCP registration of the SuperMCP servers + hooks (auto-build-on-edit, broken-build guard) + tools (build trigger, headless run) + subagents (playtest-analyzer, netcode-tester) + a `gamedev`/ultrawork skill that wires the loop.
- **L3 Compute** = cloudhome: BuildKit for builds, in-cluster headless agent Job, Nakama as netcode test target; Mac/Windows runner for live-Editor + Xcode + Roblox Studio.

## Decisions (round 2 confirmed)
- Runners available: Mac (dedicated) + Windows + can provision macOS VM/cloud. → full multi-engine feasible.
- Build vs integrate: EXTEND existing SuperMCP (already chosen by the user's existing work), orchestrate from omo.
- First deliverable: DEPTH-FIRST, reference engine = **Unity** (Unity SuperMCP already built → integration+loop proof, not a rebuild).

## Open Questions (round 3 — linchpins research can't answer)
- Q-REPO: what is THE target repo/deliverable boundary of this plan? (a) omo fork integration only, (b) generalize the Elixir SuperMCP core to multi-engine, (c) both in one plan. Single-plan mandate = if both, it's one large plan.
- Q-TOPOLOGY: confirm where each layer runs for the Unity-first loop — Unity Editor on the Mac/Windows runner (live bridge) + builds via cloudhome BuildKit + omo orchestrator where (laptop? in-cluster Job?).
- Q-LOOP: concrete Unity-first end-to-end deliverable — what is the single demonstrable "agent changed X, verified Y headlessly" proof that defines done?
- Q-VERIFY/TEST: test strategy for the integration work itself (the omo hooks/tools/skills) — TDD? tests-after? + agent QA. Separate from in-engine playtest verification.
- Q-SUPERMCP-RUNTIME: for engines NOT yet built (Godot/Unreal/Xcode), align on Elixir core reuse vs per-engine — but this may be OUT of scope if plan is Unity-first integration.

## Scope Boundaries (pending round 3)
- Likely OUT: rebuilding Unity SuperMCP; building Roblox/Godot/Unreal SuperMCP servers (separate plans); GPU scheduling in cloudhome; in-game runtime LLM.
- Likely IN: omo-side integration layer (skill-embedded MCP reg + hooks + tools + subagents + ultrawork skill), Unity-first end-to-end headless loop, cloudhome BuildKit wiring, runner topology, the decomposition reference implementation.
