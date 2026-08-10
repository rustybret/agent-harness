> **DOCUMENTATION METADATA**
> - **Origin**: Fork-Local (`rustybret/agent-harness`)
> - **Support Status**: Supported (Fork-Specific)
> - **Notes**: Cross-harness plugin consolidation architecture.

# Unified Agent OS Plugin Consolidation Architecture & Cross-Project Consensus

**Status:** Collated Peer Review Complete (Ready for Planning Phase)  
**Target Repository:** `agent-harness` (`rustybret/agent-harness`)  
**Consolidated Packages:** `omo-opencode`, `aft`, `magic-context`, `anthropic-auth`, `openai-auth`, `opencode-gemini`, `opencode-interceptor`

---

## 1. Overview & Architectural Vision

The **Unified Agent OS Plugin Consolidation** merges all core `@cortexkit` plugins, authentication providers, and agent orchestration modules into the `agent-harness` monorepo (`packages/`).

Instead of installing and maintaining multiple separate plugins with independent version lifecycles, IPC overhead, and conflicting hook execution, the entire stack is composed into a **single, version-pinned OpenCode Omni-Plugin** under the public entry `oh-my-openagent`.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               OPENCODE HOST RUNTIME                                    │
│                    Public Plugin ABI: server(input, options) -> Hooks                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                       UNIFIED AGENT OS OMNI-PLUGIN LAYER                               │
│                          (packages/omo-opencode/src/)                                  │
├───────────────────┬───────────────────┬───────────────────┬────────────────────────────┤
│ Orchestration &   │ Code Intelligence │ Long-Term Memory  │ Multi-Provider Auth &      │
│ Agent Execution   │ & Refactoring     │ & Compaction      │ Transport Interception     │
│ (OmO Core)        │ (AFT Engine)      │ (Magic Context)   │ (Anthropic/OpenAI/Gemini)  │
├───────────────────┼───────────────────┼───────────────────┼────────────────────────────┤
│ • Sisyphus Core   │ • aft_search      │ • ctx_memory      │ • Antigravity dual quota   │
│ • Metis / Momus   │ • aft_zoom        │ • ctx_note        │ • OpenAI Codex OAuth lock  │
│ • Hephaestus      │ • ast_grep_*      │ • ctx_search      │ • Anthropic sticky router  │
│ • Boulder State   │ • aft_callgraph   │ • ctx_expand      │ • Prompt-cache stabilizers │
│ • Team Worktrees  │ • aft_safety      │ • m[0]/m[1] layout│ • Fetch stream strip       │
└───────────────────┴───────────────────┴───────────────────┴────────────────────────────┘
```

---

## 2. Cross-Project Feedback & Architectural Consensus Matrix

All 7 related projects have completed technical evaluations. Below is the collated feedback, consensus decisions, and critical edge cases:

| Project | Consensus Decision | Key Architectural Guidance & Invariants |
|---------|-------------------|------------------------------------------|
| **`opencode`** | **Approved as Composition Layer** | • Treat Omni-Plugin as a version-pinned composition layer over the OpenCode plugin ABI (`PluginInput + PluginOptions -> Promise<Hooks>`).<br>• Enforce a strict 6-phase internal hook pipeline rather than relying on host plugin load order.<br>• Account for lazy activation (hooks materialize on `/agent` bootstrap, not bare `serve`).<br>• Keep all `session.prompt`/`promptAsync` dispatches routed through the shared gate (`prompt-async-gate.ts`). |
| **`aft`** | **Approved with Process Isolation** | • AFT's core indexing and AST parsing engine is written in Rust (`crates/aft`). The TypeScript packages (`@cortexkit/aft-bridge`) are thin wrappers connecting over stdio (`BridgePool`) or daemon loopback (`SubcTransportPool`).<br>• **Preserve Rust-to-TypeScript process isolation:** Do *not* compile AFT as an in-process Node-API addon to prevent native panics/segfaults from crashing the OpenCode host.<br>• Prevent duplicate LSP server spawns: AFT manages native LSP telemetry; OmO provides domain-specific routing overrides.<br>• Keep `package.json` versions strictly aligned with `aft --version`. |
| **`magic-context`** | **Approved as Dependency / Package** | • Magic Context must remain the **sole owner of `m[0]` (frozen baseline) and `m[1]` (volatile delta)**.<br>• **Prompt-Cache Stability:** Dynamic harness state (cross-project status tables, outbound budgets, presence indicators) must NEVER be prepended to `message[0]`. Keep dynamic state at the prompt tail past the `cache_control` breakpoint.<br>• Disable native host compaction (`compaction.auto: false`, `compaction.prune: false`) to avoid dual compaction conflicts.<br>• Preserve in-process tool invariants (`ctx_memory`, `ctx_reduce`, `ctx_search`). |
| **`openai-auth`** | **Approved for Monorepo Vendoring** | • **Single-Use Refresh Token Lease Lock:** Protect OpenAI Codex OAuth refresh tokens with a single-writer file/lease lock (`main-refresh.lock`) to prevent concurrent subagents from bricking tokens with `400 invalid_grant`.<br>• **Prompt-Cache Anchor:** Inject native `web_search` tool anchor to stabilize Codex prompt cache hits on tool continuation requests.<br>• **No-Replay on Emitted Streams:** Mid-stream 429/rate-limit rerouting is only permitted if `emitted === false`. Once tokens or side-effecting tool calls have been emitted, stream must terminate to prevent duplicate tool execution.<br>• Model-aware prompt cache TTLs (30m for GPT-5.6, 5m for GPT-5.4/5.5) and warm caps for Hephaestus/ultrabrain. |
| **`anthropic-auth`** | **Approved as Core Workspace Package** | • Consume `@cortexkit/anthropic-auth-core` as a modular workspace package (`packages/core`).<br>• **Sticky Session Routing:** Use `StickySessionRouter` to preserve Anthropic prompt cache hits while balancing cold sessions across spendable 5h/7d quota windows.<br>• Preserve request transformation pipeline: system prompt sanitization, Claude Code identity headers, adaptive thinking normalization, and XXH64 body signing.<br>• Response streams use `createStrippedStream()` to handle content-filter `refusal` events and trigger Fable $\rightarrow$ Opus 4.8 fallback cycles with cache prewarming. |
| **`opencode-gemini`** | **Approved with Interceptor Separation** | • Keep `opencode-gemini` / `antigravity-auth` structured as a clean transport-level interceptor layer.<br>• Direct in-process binding to `@cortexkit/antigravity-auth-core` for dual quota pool load balancing (Antigravity headers + Gemini CLI headers).<br>• Maintain Antigravity JSON schema cleaning (stripping `$ref`/`$defs` and `const`) and Gemma 4 model-limit protections (16k rolling token window, no implicit cache).<br>• Maintain account storage lock safety (`antigravity-accounts.json`). |
| **`opencode-interceptor`** | **Approved for In-Process Merging** | • Merge request/response interception hooks directly into the Omni-Plugin interface, eliminating external proxy hops and HTTP latency.<br>• Coordinate `x-initiator` header injection, clean error formatting, and tool-pair validation directly inside the Omni-Plugin execution pipeline. |

---

## 3. The 6-Phase Omni-Plugin Hook Execution Pipeline

To prevent hook ordering collisions and non-deterministic plugin behavior, `packages/omo-opencode/src/testing/create-plugin-module.ts` will execute all subsystem hooks through a unified, 6-phase internal pipeline:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      PHASE 1: BOOTSTRAP & CONFIG                       │
│ • Parse Zod v4 options & migrate legacy keys                           │
│ • Initialize Antigravity, OpenAI & Anthropic Auth storage locks        │
│ • Initialize Magic Context SQLite memory store & AFT bridge pool       │
│ • Register unified tools, subagents, and MCPs                          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 PHASE 2: INPUT & SESSION TRANSFORMS                    │
│ • experimental.chat.system.transform (Magic Context m[0] baseline)     │
│ • experimental.chat.messages.transform (Keyword detector, m[1] delta)  │
│ • chat.message (First-message variant, session setup)                  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 PHASE 3: MODEL & TRANSPORT TRANSFORMS                  │
│ • chat.params (Thinking normalization, model requirements fallback)    │
│ • chat.headers (Copilot x-initiator, Anthropic XXH64 body signing)     │
│ • Provider routing & OAuth token lease acquisition                     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 PHASE 4: PERMISSION & TOOL GUARDS                      │
│ • permission.ask (Security policies)                                   │
│ • tool.definition (Schema sanitization, stripping $ref/$defs/const)    │
│ • tool.execute.before (LSP domain context injection, write guards)     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 PHASE 5: EXECUTION & OBSERVATION                       │
│ • Direct Tool Execution (AFT, Magic Context, OmO Tools, Bridge MCPs)   │
│ • shell.env (Command environment setup)                                │
│ • tool.execute.after (Hashline read-enhancer, diagnostic fallback)     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                 PHASE 6: LIFECYCLE & CONTINUATION                      │
│ • experimental.session.compacting (Magic Context boundary preservation)│
│ • experimental.compaction.autocontinue (Boulder state resumption)      │
│ • event (Session created/idle/error, ParentWakeNotifier)               │
│ • dispose (Clean teardown of bridge pools and locks)                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Upstream Synchronization & Release Automation

To maintain 100% synchronization with upstream updates across `@cortexkit` and `oh-my-openagent` without manual merge conflicts or destructive rebases:

1. **Rebase-Free Git Mirrors (`script/sync-cortexkit.sh`):**
   - Fetch pristine upstream branches into local mirror branches:
     - `upstream/oh-my-openagent` $\rightarrow$ `packages/omo-opencode/`
     - `upstream/aft` $\rightarrow$ `packages/aft/`
     - `upstream/magic-context` $\rightarrow$ `packages/magic-context/`
     - `upstream/antigravity-auth` $\rightarrow$ `packages/antigravity-auth/`
   - Merge using Git's default merge behavior with `merge=ours` protection on custom configurations and `script/fork-sync-exclusions`.
2. **Single Release Pipeline (`bun run build:all`):**
   - Builds TypeScript bundle (`packages/omo-opencode/src/index.ts`).
   - Generates unified Zod v4 schema (`assets/oh-my-opencode.schema.json`).
   - Compiles 11 cross-platform platform binaries via Bun compile.

---

## 7. Generalized Multi-Repo Release Watcher & Auto-Upgrade Engine (`orw-core`)

We are extending `@cortexkit/orw` (`opencode-release-watch`) into a generalized multi-repo watcher and auto-upgrade engine. Rather than only compiling raw Opencode binaries, the new release watcher orchestrates automated upgrades across three distinct dependency patterns:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        GENERALIZED RELEASE WATCHER (`orw-core`)                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ • Upstream Release Poller (GitHub Releases, Git Tags, npm Registry)                    │
│ • State Persistence Engine (idempotent tracking, avoids duplicate build loops)         │
│ • Strategy Router (Fork Sync vs Vendored Mirror vs Composite PR Builder)              │
│ • In-Cluster BuildKit Dispatcher (Spawns BuildJobs on altos-worker-01)                 │
└───────────────────┬───────────────────┬───────────────────┬────────────────────────────┘
                    │                   │                   │
         Strategy 1 ▼        Strategy 2 ▼        Strategy 3 ▼
    ┌───────────────────┐ ┌───────────────────┐ ┌────────────────────────────────────────┐
    │ Fork Sync Mode    │ │ Vendored Mirror   │ │ Composite PR Builder Mode              │
    │ (e.g. opencode,   │ │ (e.g. aft,        │ │ (Upstream Tag + Custom PR Stack)       │
    │  agent-harness)   │ │  magic-context,   │ │                                        │
    │ • Pulls upstream  │ │  anthropic-auth)  │ │ • Fetches base upstream release tag.   │
    │ • script/fork-    │ │ • Tracks npm/git  │ │ • Merges cherry-picked PR list in order│
    │   sync.sh merge   │ │ • script/sync-    │ │ • Runs in-cluster BuildKit compile     │
    │ • Tests & pushes  │ │   cortexkit.sh    │ │ • Emits custom patched binary/release  │
    └───────────────────┘ └───────────────────┘ └────────────────────────────────────────┘
```

### A. Three Auto-Upgrade Strategies

1. **Fork Sync Strategy (Direct Repository Maintenance):**
   - Monitors upstream release tags/branches (e.g. `code-yeongyu/oh-my-openagent` dev/release).
   - Automatically executes `script/fork-sync.sh` to pull pristine commits into `opencode-mirror` and merge into `fork/local` using `merge=ours` and `script/fork-sync-exclusions`.
   - Runs automated regression test gates before pushing to `origin/fork/local`.

2. **Vendored Workspace Mirror Strategy (Monorepo Package Sync):**
   - Monitors release channels for individual ecosystem packages (`aft`, `magic-context`, `opencode-gemini`, `anthropic-auth`, `openai-auth`).
   - Automatically invokes `script/sync-cortexkit.sh` to update the respective subdirectory inside `packages/` while preserving workspace Zod v4 and build configurations.

3. **Composite PR Builder Strategy (Upstream Base + Custom PR Stack):**
   - Designed for repositories where custom enhancements (e.g. local fork PRs, experimental features) must be layered on top of pristine upstream releases.
   - Watches for new upstream tags $\rightarrow$ checks out base release $\rightarrow$ applies configured PR branch list sequentially $\rightarrow$ validates mergeability $\rightarrow$ compiles and publishes verified artifacts via Cloudhome BuildKit.

### B. Release Watcher Invariants & Configuration Schema (`orw.config.json`)

```jsonc
{
  "repos": [
    {
      "name": "agent-harness",
      "strategy": "fork-sync",
      "upstream": "code-yeongyu/oh-my-openagent",
      "tracking_branch": "dev",
      "local_target_branch": "fork/local",
      "sync_command": "script/fork-sync.sh"
    },
    {
      "name": "aft",
      "strategy": "vendored-mirror",
      "upstream": "cortexkit/aft",
      "vendor_path": "packages/aft",
      "sync_command": "script/sync-cortexkit.sh aft"
    },
    {
      "name": "opencode-custom",
      "strategy": "composite-pr-builder",
      "upstream": "opencode-ai/opencode",
      "base_tag_pattern": "v*",
      "apply_prs": [1042, 1089],
      "build_job_template": "k8s/base/ops/buildkit/jobs/opencode-composite-template.yaml"
    }
  ],
  "polling_interval_seconds": 300,
  "state_storage_path": ".orw/state.json",
  "buildkit_dispatch": {
    "enabled": true,
    "daemon_host": "buildkitd-amd64.ops.svc.cluster.local:1234"
  }
}
```

### C. Hardened Build Verification & Production Downstream Publishing (`orw-core`)

Based on technical feedback from `opencode-release-watch-4543544f`, `orw-core` enforces four critical operational invariants:

1. **Hardened Build Verification Gate (`install_cli: false`):**
   - Automated watcher checks **must enforce `install_cli: false`** to prevent overwriting active CLI executables (`~/.opencode/bin/opencode`).
   - Every build must pass a 5-step isolated smoke gate before artifact publishing:
     - **Step 1:** Bind an ephemeral local port (`127.0.0.1:<free-port>`).
     - **Step 2:** Isolate execution in temporary `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` sandbox directories (`qa-sandbox.sh`).
     - **Step 3:** Invoke `opencode serve --pure --print-logs`.
     - **Step 4:** Probe `GET /agent` expecting HTTP 200 + valid JSON agent array within a 30s deadline.
     - **Step 5:** Deterministic process reaping (`SIGTERM` $\rightarrow$ `SIGKILL`) and tmpdir cleanup on both success and failure.

2. **Daemon Supervision & Lockfile Auto-Expiry:**
   - `.orw/state.json` maintains heartbeat metadata (`last_check_timestamp`, `last_successful_tag`).
   - Lockfiles (`.orw/repo/*.lock`) store `{ pid, timestamp }`. Locks older than 30 minutes are auto-evicted if the owning process PID is dead, preventing daemon hangs.

3. **Composite PR Builder & Conflict Taxonomy:**
   - **Silent Import/Binding Drops:** Clean git merges across Effect-TS / DI layers can drop required module imports (`Plugin.Service`) without text conflicts. All composite builds must pass `bun typecheck` and the isolated `GET /agent` smoke gate.
   - **Interleaved Test Conflicts:** Standard resolution rule for generated/lockfile/test conflicts: take HEAD via `git checkout --ours`.

4. **Downstream Publishing Pipeline:**
   - Automated pushes update both permanent snapshot branches (`integrate/vX.Y.Z`) and the floating production pointer (`fork/release`) consumed by external cluster pollers (e.g. Cloudhome).
   - Automated pushes execute with `git push --no-verify` to bypass local pre-push hooks on known fork type overrides.

---

## 8. Summary of Active Consultation Agents

All input agents across the ecosystem have been incorporated into the master consolidation architecture:

| Component / Agent | Source Project | Key Focus & Responsibility in Consolidated Stack |
|-------------------|----------------|--------------------------------------------------|
| **`opencode`** | `opencode-228cc625` | Public OpenCode Plugin ABI composition root (`server(input, options)`), 6-phase hook pipeline, and deterministic execution order. |
| **`aft`** | `aft-5fc3f7ed` | Native code search, symbol zoom, AST rewrites, callgraph analysis, and safety backups preserving Rust-to-TypeScript process isolation. |
| **`magic-context`** | `magic-context-6deb493e` | Long-term cross-session memory (`ctx_memory`), note reminders, history recovery, and prompt-cache layout (`m[0]` baseline, `m[1]` delta). |
| **`openai-auth`** | `openai-auth-bf478581` | OpenAI Codex OAuth session leases, single-use refresh token locks (`main-refresh.lock`), prompt-cache stabilizers, and Hephaestus model mappings. |
| **`anthropic-auth`** | `anthropic-auth-1369fa0e` | Anthropic sticky session routing, adaptive thinking normalization, Claude Code headers, and Fable refusal recovery streams. |
| **`opencode-gemini`** | `opencode-gemini-ec2cac67` | Antigravity & Gemini transport interceptor, dual quota pool management, JSON schema cleaning, and Gemma 4 model limits. |
| **`opencode-interceptor`**| `opencode-interceptor-d1f55155`| In-process request/response transformation, `x-initiator` header injection, and tool-pair validation without proxy latency. |
| **`cloudhome`** | `cloudhome-5aa53d2c` | In-cluster BuildKit CI pipelines on `altos-worker-01`, GitHub webhook routing via Cloudflare Worker, and in-cluster Renovate scanning. |
| **`opencode-release-watch`**| `opencode-release-watch-4543544f`| Multi-repo automated release poller, fork sync automation, vendored package updates, and composite PR compilation. |


The CI and autonomous maintenance workflows are not invented ad-hoc; they directly integrate with **Cloudhome's established in-cluster infrastructure and runbooks** (`cloudhome-5aa53d2c`):

### A. Webhook-Triggered In-Cluster CI Pipeline
```
┌────────────────────────┐      Push / PR Webhook Event         ┌──────────────────────────────┐
│ GitHub Repository      │ ─────────────────────────────────>  │ Cloudflare Worker            │
│ (rustybret/agent-harness)│                                    │ (build-relay.rustybret.com)  │
└────────────────────────┘                                    └──────────────┬───────────────┘
                                                                             │ HMAC Validate (Vault: buildkit-webhook-secret)
                                                                             │ Header: Cloudhome-Build-Mode: explicit
                                                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              K3S OPS NAMESPACE (altos-worker-01)                       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. `build-dispatcher` (Internal Webhook Ingress):                                      │
│    • Matches `rustybret/agent-harness` in `repo-map.js`.                               │
│    • Spawns K8s BuildJob from `agent-harness-amd64-template.yaml`.                     │
│    • Injects GitHub PAT (`ultrabot-github-pat`) synced from OCI Vault via ESO.         │
│                                                                                        │
│ 2. BuildKit Daemon Execution (`buildkitd-amd64.ops.svc.cluster.local:1234`):           │
│    • Hosted on `altos-worker-01` (Dual Xeon 96 threads, 256GB RAM, ZFS storage).      │
│    • Build cache: `/var/lib/buildkit-amd64` + `mirror.gcr.io` pull-through registry.   │
│                                                                                        │
│ 3. Hermetic Multi-Stage Execution Pipeline:                                            │
│    • Stage 1 (`test`): `bun install --frozen-lockfile` -> `bun test` (all packages).  │
│    • Stage 2 (`build`): `bun run script/build-binaries.ts` (multi-arch distribution).  │
│    • Stage 3 (`publish`): Pushes verified tags to OCIR (`ocir.us-sanjose-1.oci...`)    │
│      using `--mount=type=secret,id=dockerconfigjson`.                                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### B. Dependabot & Security Automation (In-Cluster Renovate)
1. **In-Cluster Renovate Runner:** Configured in `k8s/base/updates/` (nightly CronJob in `updates` namespace) consuming repo-root `renovate.json`.
2. **Automated Testing & Automerge Gates:** Minor and lockfile updates auto-merge only after passing `bun test` and `oh-my-openagent doctor` inside isolated K8s pods with disposable `XDG_CONFIG_HOME` / `XDG_DATA_HOME` sandboxes.
3. **Zero Plaintext Secrets:** OCI Vault stores all registry, GitHub, and provider tokens; External Secrets Operator (ESO) syncs them to Kubernetes Secrets for BuildKit secret mounts.

### C. Ultrabot Autonomous Maintenance & Sync Engine
1. **Scheduled Upstream & Cortexkit Sync:** Cloudhome's `ultrabot` runner (`k8s/base/ultrabot/`) schedules CronJobs executing `script/fork-sync.sh` and `script/sync-cortexkit.sh`.
2. **Automated Verification Loop:** Merges into `fork/local` -> runs regression suite (`bun test`) -> pushes to `origin/fork/local` only when clean.
3. **Discord Alert Routing:** Build failures, sync statuses, and health diagnostic errors post alerts to Discord via `openclaw-cloudhome` / `openclaw-ebaybo` relay (`POST https://ebaybo-relay.work.rustybret.com/post`).

### D. Cloudhome Onboarding Steps for Consolidation Release
1. Register `rustybret/agent-harness` in `docker/build-dispatcher/src/repo-map.js`.
2. Apply `k8s/base/ops/buildkit/jobs/agent-harness-amd64-template.yaml`.
3. Configure the GitHub repository webhook targeting `https://build-relay.rustybret.com/webhook`.

