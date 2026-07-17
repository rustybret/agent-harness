# Plan: External-Event → Active-Session Injection Bridge (Option B)

**Status:** DRAFT — awaiting review
**Owner:** agent-harness fork (`fork/local`)
**Requested by:** unitySuperMCP (Unity Editor MCP bridge) via cross-project mailbox note `39c8f0d2`
**Author:** Sisyphus
**Date:** 2026-07-16

---

## 1. Goal

Build the **harness-side half** of a generic "external event → inject a message into the correct active opencode session" bridge, so a third-party MCP server (unitySuperMCP's Elixir watcher, and future variants) can deliver a `<system-reminder>`-equivalent into a live session **without the agent polling** — reusing the same sanctioned injection path already proven for background-task completion and cross-project mailbox delivery.

Near-term consumer: exactly one tool (unitySuperMCP) or variations of it. Design for that, but shape the surface so it can become a standardized external-inject capability later without rework.

## 2. Non-Goals

- NOT building the SuperMCP-side Elixir watcher (that is unitySuperMCP's follow-up work, gated on the integration spec this plan delivers as §9).
- NOT solving MCP `notifications/*` client relay (confirmed dead-end; wrong layer).
- NOT a public/remote-network surface. Loopback-only (`127.0.0.1`), token-authed, same-host only.
- NOT changing `dispatchInternalPrompt` or the prompt-async-gate internals. We are a new *caller* of the existing gate, not a new gate.
- NOT enabling this by default. Config-gated, opt-in, off unless configured.

## 3. Key facts grounding this design (verified against source)

- **The plugin holds a live injection client.** opencode plugins run in-process with `client` + `serverUrl` (falls back to `http://localhost:4096`). The *external* process never needs a reachable session port; it POSTs to a **plugin-hosted loopback listener**, which owns injection. (librarian research + mailbox feature precedent.)
- **`dispatchInternalPrompt`** (`packages/utils/src/prompt-async-gate.ts`) is the ONE sanctioned injection primitive. Arg shape (from `idle-drain-hook.ts` template):
  ```ts
  dispatchInternalPrompt({
    mode: "async",
    client,                       // plugin's session client
    sessionID,
    source: EXTERNAL_INJECT_SOURCE,
    input: {
      path: { id: sessionID },
      body: { parts: [{ type: "text", text }] },
      query: { directory },
    },
    queueBehavior: "defer",       // wait for idle, don't interrupt a live turn
  })
  ```
  It already enforces reservation / post-dispatch hold / semantic-dedupe / coalescing / live-route-vs-fallback. Accepted iff `isInternalPromptDispatchAccepted(result)` (status `dispatched` | `queued`).
  **AGENTS.md invariant #584:** every `session.prompt`/`promptAsync` MUST route through this gate. This plan does — it adds a caller, not a new raw route.
- **AFT (MIT) ships the exact transport blueprint** at `/Volumes/Topper2TB/Git/aft/packages/opencode-plugin/src/shared/rpc-server.ts` + `rpc-utils.ts`. We adapt (not import) it. Attribution to CortexKit already exists in this repo; extend it for this file. Blueprint elements to port:
  - Dual Bun/Node `serve` on `127.0.0.1:0` (random port).
  - Port-file discovery: `<storageDir>/rpc/<projectHash>/ports/<instanceId>.json` containing `{ port, token, pid, started_at }`, written atomically (tmp + rename), mode `0o600`, dir `0o700`.
  - Token auth via `crypto.timingSafeEqual` (constant-time). 32-byte hex token per instance.
  - `POST /rpc/<method>` (JSON body, `MAX_BODY_BYTES` cap, token in body), `GET /health`.
  - Self-heal heartbeat (rewrite port file if deleted), dead-pid sweep of sibling files, `stop()` cleanup (unlink port file, close server, `unref()` so it never keeps the process alive).
- **Active session resolution:** `resolveActivePrimaryAgent(sessionId)` reads the per-session agent map (`claude-code-session-state/state.ts`). The set of *live* session IDs is tracked via the `event` hook (`session.created` / `session.idle` / `session.deleted`). The bridge tracks active sessions the same way; SuperMCP does NOT choose the session.
- **Wiring precedent:** `create-mailbox-session-hooks.ts` shows the feature-init shape — config-gated, `safeCreateHook`, threaded `ctx` (client, directory). The bridge mounts alongside it in plugin init.

## 4. Architecture

```
Unity Editor event (compile error, console error threshold)
  │
  ▼
unitySuperMCP (Elixir)  ── reads port-file, POSTs {token, text, [addressing]} ──►
  │
  ▼
[NEW] External-Inject Loopback Listener   (packages/omo-opencode/src/features/external-inject/)
  │   • loopback HTTP server 127.0.0.1:0, port-file + token (adapted from AFT)
  │   • resolves target session (see §5 addressing)
  │   • coalesce / rate-limit (see §6)
  ▼
dispatchInternalPrompt({ mode:"async", queueBehavior:"defer", ... })   (EXISTING gate)
  │
  ▼
<system-reminder> lands in the target session's next turn
```

## 5. Session addressing (the hard constraint)

**Problem:** an external event doesn't inherently know which opencode session to hit, and default in-process TUI binds no external session port. The bridge's OWN loopback listener sidesteps the port problem (it is plugin-hosted). Addressing rules:

- **Default (no `sessionID` in request): "active session for this project."** The bridge tracks live sessions via the `event` hook and picks the most-recently-active one for `ctx.directory`. This is the common case — SuperMCP watches one project's Unity editor and wants "tell whoever is working here."
- **Explicit `sessionID` (optional):** if the caller passes a `sessionID`, the bridge validates it is a known live session for THIS project (fail-closed if unknown/foreign) before injecting. Lets an advanced caller target a specific session.
- **Project scoping is mandatory.** The port-file is under `<projectHash>/`, so a caller that discovered THIS project's port file can only reach THIS project's sessions. Cross-project injection is not possible via one port file (matches AFT's per-project scoping).
- **No active session → 409, dropped (resolved Q2).** If there is no live session for the project, return HTTP 409 `{status:"no-active-session"}` and drop. No queue/hold: a call with no active session means the tool is human-run or there was a session/connection error — the caller retries.

## 6. Rate-limiting / coalescing / auth (the operational contract)

- **Auth:** constant-time token compare; token minted per plugin instance, written to the `0o600` port file. Missing/wrong token → 403. Loopback bind only (never `0.0.0.0`).
- **Body cap:** reuse AFT's `MAX_BODY_BYTES` (1 MiB). Text part additionally capped (see §11 Q3 for the limit) → 413 on overflow.
- **Coalescing:** identical `(sessionID, text)` within a short window collapses to one injection. `dispatchInternalPrompt`'s semantic-dedupe already does most of this; the bridge adds a source-level coalesce key `external-inject:<hash(text)>` so a chatty Unity watcher firing the same "compile error" 5×/sec becomes one reminder.
- **Rate limit:** token-bucket per project (default: N injections / window — see §11 Q4). Over-limit → 429. Prevents an external process from flooding a session.
- **Delivery semantics = `queueBehavior:"defer"`:** injection waits for session idle rather than interrupting a live turn (matches mailbox). This is **push-on-next-safe-point**, not preempt-mid-turn. Call this out explicitly to unitySuperMCP so they design their watcher around "delivered when the agent is between turns," not "interrupts instantly."

## 7. Config surface (opt-in, off by default)

New config block `external_inject` on the plugin config (schema under `packages/omo-opencode/src/config/schema/`, wired into `OhMyOpenCodeConfigSchema`, snake_case, Zod v4). Fields:
```jsonc
{
  "external_inject": {
    "enabled": false,                    // master gate, default false
    "allow_default_active_session": true,// permit "active session for project" addressing
    "max_text_bytes": 8192,              // per-injection text cap (configurable)
    "rate_limit": { "max": 20, "window_ms": 60000 }  // per-project bucket (configurable)
    // no_active_session_policy REMOVED — always drop (409) per resolved Q2
  }
}
```
Tool gating: the loopback listener only starts when `external_inject.enabled === true`. When disabled, zero listener, zero port file, zero surface — fail-closed.

## 8. Deliverables (task breakdown)

Each task is atomic, TDD (RED test first), self-owned commit on `fork/local`. Files live under a new feature dir `packages/omo-opencode/src/features/external-inject/`.

- **T0 — Config schema.** Add `external_inject` schema file + wire into `OhMyOpenCodeConfigSchema`; `bun run build:schema`. RED: schema test asserts defaults (`enabled:false`) and field validation. **~80 LOC.**
- **T1 — Loopback listener (adapted from AFT, attributed).** Port `rpc-server.ts` transport (dual Bun/Node serve, port-file discovery, token auth, self-heal, dead-pid sweep, `stop()`). Strip AFT's WS/notification-sink machinery — we only need the three POST methods. Methods: `GET /health`, `POST /rpc/inject`, `POST /rpc/describe` (returns capability metadata: bridge version, addressing modes, current `rate_limit` + `max_text_bytes`, method list). Keep files < 200 LOC (split transport / port-file / handler). RED: server starts on loopback, writes port file `0o600`, rejects bad token (403), rejects oversize (413), accepts valid inject POST, `describe` returns capability JSON. **~200 LOC across 3 files.**
- **T2 — Session-addressing resolver.** `resolveTargetSession(request, { directory, liveSessions })`: default active-for-project, explicit-sessionID validation (fail-closed), 409 on none. RED: table tests for each addressing branch. **~90 LOC.**
- **T3 — Injection adapter.** Wrap `dispatchInternalPrompt` with `source: EXTERNAL_INJECT_SOURCE`, `queueBehavior:"defer"`, coalesce key, `isInternalPromptDispatchAccepted` check → HTTP status mapping (202 accepted / 409 no-session / 429 rate-limited / 503 gate-unavailable). RED: mock gate returns each status, assert HTTP mapping + that raw `promptAsync` is never called outside the gate (mirror the prompt-async-route-audit invariant). **~110 LOC.**
- **T4 — Rate limiter + coalescer.** Per-project token bucket + short-window dedupe. RED: burst of identical events → 1 injection; over-limit → 429. **~90 LOC.**
- **T5 — Plugin-init wiring.** Mount the listener in plugin init alongside `create-mailbox-session-hooks.ts` pattern: config-gated, `safeCreateHook`-style guarded, track live sessions via the `event` hook, `stop()` on dispose. RED: enabled→listener starts + port file present; disabled→no listener, no port file. **~120 LOC.**
- **T6 — Unit + integration test pass.** Full `bun test` on the feature + `bun run typecheck` clean.
- **T7 — Live QA (MANDATORY, opencode-qa skill).** Isolated XDG sandbox: start a real opencode session with `external_inject.enabled`, read the port file, `curl` a POST with the token, assert the injected text appears in the session (via `opencode run --format json` or session DB), assert bad-token 403 + rate-limit 429. Prove isolation (session-count before/after). Evidence → `.omo/evidence/<date>-external-inject/`.
- **T8 — Integration spec doc for unitySuperMCP (§9).** Write the spec doc, deliver via `project_message` reply.
- **F1–F4 — Final verification wave:** goal-completeness, code-quality (200-LOC ceiling, no `as any`, comment-checker clean), security (loopback-only, token constant-time, fail-closed, no cross-project reach), hands-on QA re-run.

## 9. Integration spec to hand back to unitySuperMCP (the §3 ask #3 deliverable)

The spec doc will specify, concretely:
1. **Discovery:** read `<XDG_DATA_HOME or ~/.local/share>/oh-my-openagent/rpc/<projectHash>/ports/<instanceId>.json`; `projectHash` derivation documented. Pick newest live (pid-alive) entry.
2. **Handshake:** `POST http://127.0.0.1:<port>/rpc/inject` with JSON `{ token, text, sessionID? }`. `GET /health` for liveness. `POST /rpc/describe` (with token) for capability metadata (bridge version, addressing modes, current rate-limit + max_text_bytes, method list) so the watcher self-configures.
3. **Auth:** token from the port file, sent in body; constant-time compared.
4. **Addressing:** omit `sessionID` for "active session for this project"; pass it to target a specific known session.
5. **Rate/coalesce:** document the bucket (default 20/60s, read live from `describe`) + dedupe window so the Elixir watcher self-throttles.
6. **Delivery semantics:** `defer` = delivered at next idle, not mid-turn. SuperMCP designs its threshold-watcher around eventual (seconds-scale) delivery, not hard real-time preemption.
7. **Error contract:** 202 accepted, 403 bad token, 409 no active session (dropped — retry), 413 too large, 429 rate-limited, 503 gate unavailable/disabled.

## 10. Risks / mitigations

- **Duplicate-injection (the #584 hazard):** mitigated by routing through the existing gate (reservation + semantic-dedupe) AND a source-level coalesce key. T3 adds a route-audit-style test proving no raw `promptAsync` outside the gate.
- **Port-file leakage / stale ports:** AFT's dead-pid sweep + self-heal heartbeat + `stop()` unlink handle this. Loopback + `0o600` limits exposure to same-user same-host.
- **Multiple plugin instances (`opencode --port 0` spawns two):** per-instance port file (instanceId) + newest-live selection, exactly as AFT solved it.
- **Off-by-default:** zero surface unless explicitly enabled; no attack surface for users who don't opt in.

## 11. Resolved decisions (reviewed + approved 2026-07-16)

- **Q1 — Storage root:** RESOLVED → **XDG data home** (`~/.local/share/oh-my-openagent/rpc/<projectHash>/ports/<instanceId>.json`). Transient runtime state, not tracked workspace state. Respect `XDG_DATA_HOME` when set (matches the QA sandbox convention).
- **Q2 — No-active-session policy:** RESOLVED → **`drop`** (return 409, no queue). Rationale (user): an MCP tool with no active session is either being human-run or there has been a session/connection error — holding is wrong; the caller retries. `no_active_session_policy` config key is REMOVED (always drop for v1).
- **Q3 — Max text bytes per injection:** RESOLVED → default **8 KiB**, **configurable** via `external_inject.max_text_bytes`. 413 on overflow.
- **Q4 — Rate limit defaults:** RESOLVED → default **20 / 60 000 ms per project**, **configurable** via `external_inject.rate_limit.{max,window_ms}`. 429 on over-limit.
- **Q5 — Method surface:** RESOLVED → **`inject` + `health` + `describe`**. `describe` returns capability metadata (bridge version, accepted addressing modes, current rate-limit + max_text_bytes, method list) so a caller can self-configure without out-of-band docs.

### Parallel-build ownership (path b, approved)

- **Sync-first-then-build:** deliver the §9 integration spec to unitySuperMCP FIRST (this session, now), so their Elixir watcher work proceeds in parallel with the agent-harness build.
- **Arbiter of "done" + e2e owner: unitySuperMCP.** The harness side (this fork) is responsible for its own unit + opencode-qa gates (T6/T7) proving the bridge works in isolation. The **end-to-end** acceptance (real Unity event → real injection into a live session) is owned and run by unitySuperMCP; the feature is declared complete when unitySuperMCP's e2e passes against a built agent-harness bridge. Coordinate closure via the mailbox thread.

## 12. Implementation status — COMPLETE (harness side) 2026-07-16

All tasks landed on `fork/local`, TDD RED→GREEN per task.

| Task | What | Status |
| --- | --- | --- |
| T0 | Config schema `external_inject` (off by default) + JSON schema regen | DONE |
| T1 | Loopback listener: port-file (0600, XDG) + transport (Bun/Node, 127.0.0.1:0) + handler (auth/inject/describe) | DONE |
| T2 | Session-addressing resolver (active-for-project / explicit sessionID) | DONE |
| T3 | Injection adapter routing through `dispatchInternalPrompt` (defer + coalesce key; #584 route audit passes) | DONE |
| T4 | Rate limiter (token bucket) + coalescer | DONE |
| T5 | Plugin-init mount + live-session tracker fed by event hook + stop() on dispose | DONE |
| T6 | Full-suite gate: workspace typecheck clean, feature suite green | DONE |
| T7 | Live QA vs real `opencode serve` in isolated XDG sandbox | DONE |

**F-wave (all PASS):**
- F1 goal/scope: matches plan + unitySuperMCP's 3 asks; integration spec delivered (mailbox msg `58ba70c4`).
- F2 code quality: every source file < 200 LOC (max transport.ts 143); zero `as any`/`@ts-ignore`.
- F3 security: loopback-only bind (`127.0.0.1`), `timingSafeEqual` token check on EVERY method, fail-closed, port-file `0o600`, no secret in evidence.
- F4 regression: workspace typecheck 0 errors; 148 pass / 0 fail across feature + touched files + #584 audit.

**Live QA proof** (`.omo/evidence/20260716-external-inject/`): 9/9 HTTP contract assertions + injected marker LANDED in a real session's messages + isolation proven (real DB 6195→6195 unchanged).

**Key discovery:** plugin `server()` hook (which starts the bridge) fires lazily on first project bootstrap (`GET /agent?directory=<dir>`), not on `Server.listen`.

**Remaining:** unitySuperMCP owns the true end-to-end (real Unity event → their Elixir watcher → POST → injection). Feature declared complete on their e2e pass against the built bridge.
```
