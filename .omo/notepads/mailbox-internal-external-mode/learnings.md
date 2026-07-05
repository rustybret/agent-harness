## [2026-07-04T07:12:51Z] Task: T1

PresenceRecord schema: added `mode` + nullable `serverUrl`. Final shape downstream can rely on.

### Exact locations
- `presence/presence-record.ts:11-20` — `PresenceRecord` interface. New: `export type PresenceMode = "internal" | "external"`. Interface now has `mode: PresenceMode` and `serverUrl: string | null` (was `string`). `writePresenceRecord` unchanged (serializes whatever it gets).
- `presence/presence-heartbeat-hook.ts:33-41` — `buildRecord` now emits `mode: "external"` (placeholder; T4 wires real detection). serverUrl still `deps.serverUrl` (current behavior). No runtime-logic change.
- `presence/presence-reader.ts:21-33` — `isPresenceRecord` is now EXPORTED and validates: `mode === "internal" || "external"` AND `serverUrl` is `string || null`. Rejects missing/unknown mode and non-string/non-null serverUrl (e.g. number 123).
- `presence/presence-reader.ts:46-49` — `defaultProbeSession` now short-circuits `return false` when `serverUrl === null` (null-safe; T2/T5 own the real internal short-circuit).
- `presence/index.ts` — barrel now re-exports `isPresenceRecord` + `type PresenceMode`.

### Final interface (canonical, for T2-T8)
```ts
export type PresenceMode = "internal" | "external"
export interface PresenceRecord {
  projectId: string
  repoRoot: string
  mode: PresenceMode
  serverUrl: string | null
  sessionId: string
  pid: number
  heartbeatTs: number
}
```

### Guard contract
`isPresenceRecord(value)` true IFF: projectId string, mode in {internal,external}, serverUrl string|null, sessionId string, heartbeatTs number. (repoRoot/pid NOT validated — same as pre-existing guard which only checked projectId/serverUrl/sessionId/heartbeatTs.)

### Surprise / note for downstream
- Pre-existing `presence-heartbeat-hook.test.ts:43` asserts the FULL record shape via `toEqual` — had to add `mode:"external"` there too. Any future field addition to the record must update that fixture.
- Test `makeRecord` helpers in `presence-record.test.ts` + `presence-reader.test.ts` default `mode:"external"`; pass `{ mode:"internal", serverUrl:null }` for internal shapes.

### Verification
- `bun test presence/` -> 23 pass / 0 fail.
- `bun run typecheck:packages` -> exit 0 (all workspace packages incl. omo-opencode).
- `lsp_diagnostics` presence/ -> 0 diagnostics.


## [2026-07-04T07:15:08Z] Task: T2

Rewrote `defaultProbeSession` in `presence/presence-reader.ts` to be directory-scoped + session-live (membership-gated). Guard/type (T1) left untouched.

### CONFIRMED /session/status contract (read from sibling opencode checkout /Volumes/Topper2TB/Git/opencode)
- Endpoint: `GET ${serverUrl}/session/status`. Path const at `httpapi/groups/session.ts:80` (`status: ${root}/status`, root=`/session`).
- Handler (`httpapi/handlers/session.ts:77-79`): `status = () => Object.fromEntries(yield* statusSvc.list())`. So the RESPONSE BODY IS A JSON MAP keyed by session id, values are status objects like `{ type: "idle" | "busy" | ... }`. NOT wrapped in `{data:...}` at the HTTP layer (that wrapping is an SDK-client concern; a raw `fetch` gets the bare map).
- Directory resolution (`httpapi/middleware/workspace-routing.ts:87`): `url.searchParams.get("directory") || request.headers["x-opencode-directory"] || process.cwd()`. Query param wins, header is fallback. We send BOTH (belt-and-suspenders per plan). `/session/status` is a `forward` route (workspace-routing.ts:7) so directory scoping actually routes to the right instance under a shared serve.

### Final probe signature + return contract (for T3 self-probe reuse + T5 reader)
```ts
export async function defaultProbeSession(record: PresenceRecord): Promise<boolean>
```
- `record.serverUrl === null` (internal) -> returns `false` immediately, NO fetch. (null-safe; T5 routes around calling it entirely.)
- Builds URL via `new URL(`${base}/session/status`)` + `searchParams.set("directory", record.repoRoot)`.
- Headers: always `x-opencode-directory: record.repoRoot`; adds `Authorization` only when `getServerBasicAuthHeader()` returns a value (unchanged auth helper, env `OPENCODE_SERVER_PASSWORD`).
- Timeout: `AbortSignal.timeout(2000)` (DEFAULT_PROBE_TIMEOUT_MS).
- Liveness gate: `response.ok` AND `isRecord(payload)` AND `Object.hasOwn(payload, record.sessionId)`. Returns `true` ONLY when the record's sessionId is a KEY in the status map. Empty map / different-key map / non-200 / connect-error / timeout -> `false`.
- Uses `isRecord` from `@oh-my-opencode/utils` (barrel export of record-type-guard).

### Why membership, not `{type}` value
Plan gates liveness on MEMBERSHIP (key present) = server actively tracks it as a live session. Captured `type` value is available for richer status later (T3/T5) but is NOT used to decide live/not-live here.

### Verification
- `bun test presence/presence-reader.test.ts` -> 17 pass / 0 fail (6 new `defaultProbeSession` cases: live, empty-map stale, wrong-key stale, connect-error false, non-200 false, null-serverUrl false-no-fetch).
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` -> exit 0.
- `lsp_diagnostics` on probe + test -> 0 diagnostics.

### Note for T3/T5
- Tests mock `globalThis.fetch` (save/restore in afterEach) rather than injecting fetch — probe reads `globalThis.fetch` directly. If T3's self-probe wants injectable fetch, it can still call `defaultProbeSession` unchanged; only global-fetch mocking is needed to test it.
- `defaultProbeSession` is now EXPORTED (was module-private) so T3 can reuse it directly against `{serverUrl: ourUrl, repoRoot: ourRoot, sessionId: ourSid}`.


## [2026-07-04T08:05:00Z] Task: T3

New file `presence/mode-detector.ts` (+ barrel export). Self-probes OUR OWN serverUrl, memoizes per session, retries the freshly-created race, timeout-defaults to internal, transition-logs only on change.

### Final factory signature (canonical, for T4/T7/T8)
```ts
export type MailboxMode = "internal" | "external"          // = PresenceMode
export type MailboxModeState = MailboxMode | "unknown"
export type ModeDetectTrigger = "start" | "resume" | "tool-exec"
export type ModeDetectorLog = (message: string, data?: unknown) => void

export interface ModeDetectorDeps {
  resolveServerUrl: () => string | null   // e.g. () => ctx.serverUrl?.toString() ?? getServerBaseUrl(ctx.client)
  repoRoot: string                        // ctx.directory
  probe: (record: PresenceRecord) => Promise<boolean>  // production: defaultProbeSession from presence-reader (T2)
  now?: () => number                      // default Date.now
  settleMs?: number                       // default 150 (settleAfterSessionIdle)
  probeTimeoutMs?: number                 // default 2000
  log?: ModeDetectorLog                   // default shared/logger `log`; injectable for tests
}

export interface ModeDetector {
  detect(sessionId: string, trigger: ModeDetectTrigger): Promise<MailboxMode>  // "internal" | "external"
  currentMode(): MailboxModeState                                              // "internal" | "external" | "unknown"
}

export function createModeDetector(deps: ModeDetectorDeps): ModeDetector
```

### Trigger vocabulary (T4 MUST use these exact literals)
- `"start"`  -> session became active first time (session.created / first idle). Detects if sessionId is NEW.
- `"resume"` -> explicit resume of an already-seen session. ALWAYS re-detects + checks transition.
- `"tool-exec"` -> a tool ran before any detect (T7/T8 lazy-prime path). Detects only if sessionId is unknown/new.
- Re-detection rule: runs IFF `sessionId !== memoSessionId` OR `trigger === "resume"`. Every other call returns memoized value with ZERO I/O (no probe). `currentMode()` NEVER probes.

### Detection algorithm
1. `resolveServerUrl()` falsy (null/"") -> `internal`, reason `"no-server-url"`, NO probe.
2. Build self PresenceRecord `{ projectId:"self-probe", repoRoot, mode:"external", serverUrl, sessionId, pid, heartbeatTs:now() }` and call `probe(record)` wrapped in a `probeTimeoutMs` race.
3. probe present -> `external` reason `"session-live"`.
4. probe throws OR times out -> `internal` reason `"timeout"` (distinguishable), NO retries.
5. probe reachable-but-absent (returns false) -> settle `settleMs` then retry, up to 2 retries (3 probe calls total). present-on-retry -> `external` reason `"session-live-retry"`; error-on-retry -> `internal` reason `"timeout"`; still absent after all retries -> `internal` reason `"session-absent"`.

### Exact log call shapes (T9 asserts these)
- Every first-detect AND every resume-that-runs:
  `log("[mailbox-mode] detected", { mode, sessionId, trigger, reason })`
  reasons: `"no-server-url" | "session-live" | "session-live-retry" | "timeout" | "session-absent"`.
- ONLY when memoized mode actually changes value (and prior state was not "unknown"):
  `log("[mailbox-mode] transition", { from, to, sessionId })`.
  First-ever detect (from "unknown") emits detected only, never transition.

### Production wiring hint for T4
`probe` production dep = `defaultProbeSession` (exported from presence-reader.ts, T2). `resolveServerUrl` should mirror create-mailbox-hooks.ts:128 (`ctx.serverUrl?.toString() ?? getServerBaseUrl(ctx.client)`). Detector is stateful/long-lived: create ONCE per plugin session, call `detect` on session-active/resume edges, read `currentMode()` at tool-exec.

### Verification
- `bun test presence/mode-detector.test.ts` -> 12 pass / 0 fail (no-url, external+detected-log, memoize-no-reprobe, currentMode unknown/memoized, throw->timeout, hang->timeout, absent-then-present retry, absent-all-retries=3 probes, external->internal resume=1 transition, resume-no-change=0 transition/2 detected, new-sessionId re-probes).
- `bun test presence/` -> 41 pass / 0 fail (no regression).
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` -> exit 0.
- `lsp_diagnostics` mode-detector.ts + test -> 0 diagnostics.

### Note for T7/T8
- The `log` dep is injectable purely for tests (LoggerTestOverrides only swaps file path, not a line-writer, so a direct injectable `log` was the clean way to assert log calls). Production omits it -> uses shared `log`.

## [2026-07-04 01:21 PDT] Task: T4 (fixed)

Wired the T3 ModeDetector into the heartbeat so the presence record is mode-tagged from a live self-probe instead of the hardcoded `mode:"external"`.

### What changed (4 source + 2 test files)
1. `presence/presence-heartbeat-hook.ts`
   - `PresenceHeartbeatDeps.serverUrl` is now `string | null` (internal sessions have no bound url).
   - Added optional `modeDetector?: Pick<ModeDetector, "detect" | "currentMode">`.
   - `onSessionActive(sessionId, trigger: ModeDetectTrigger = "start")` now takes a trigger.
     When a detector is present it calls `detector.detect(sessionId, trigger).then(beat, beat)` so the
     FIRST beat reflects the resolved mode; `.then(beat, beat)` guarantees a beat even if detect rejects
     (internal sessions must never stop beating). No detector -> immediate `beat()` (legacy path).
   - `buildRecord` reads `detector?.currentMode() ?? "external"`; treats anything != "internal" as external
     (so `"unknown"` keeps the legacy external default and peers still see freshness). External record
     carries real `serverUrl`; internal record carries `serverUrl: null` + `mode:"internal"`.
   - The 10s `setInterval` beat loop is UNCHANGED -> both modes keep refreshing `heartbeatTs`. Because
     `detect()` memoizes per session (T3), the recurring idle/interval beats never re-probe; only a NEW
     sessionId or `trigger:"resume"` re-detects.
2. `presence/index.ts` - re-export `defaultProbeSession` from the barrel (needed by create-mailbox-hooks).
3. `hooks/create-mailbox-hooks.ts`
   - `buildPresenceHeartbeatHook` NO LONGER early-returns on a null serverUrl (that used to disable the
     hook entirely). It now builds `resolveServerUrl = () => ctx.serverUrl?.toString() ?? getServerBaseUrl(ctx.client)`,
     constructs `createModeDetector({ resolveServerUrl, repoRoot, probe: defaultProbeSession })`, and passes
     it into `createPresenceHeartbeatHook`. Only `projectIdForRoot` failure still returns null.
   - Exported `buildPresenceHeartbeatHook` + added a `PresenceHeartbeatOverrides` (Pick of writeRecord/homeDir/now)
     optional 2nd arg purely as a TEST SEAM so the wiring test can capture the written record in-memory.
4. `plugin/event.ts` - both heartbeat call sites now pass an explicit trigger literal.

### event.ts trigger mapping decision (T9/T11 read this)
Both current call sites map to `"start"`:
- `event.ts` session.created handler (was ~line 156): `onSessionActive(createdSessionID, "start")`.
- `event.ts` `dispatchIdleOnlyHooks` (idle-driven, was ~line 84): `onSessionActive(mailboxSessionID, "start")`.
Rationale: the existing event layer does NOT distinguish fresh-launch from `--continue`/resume at these two
sites - both `session.created` and `session.idle` fire `onSessionActive` with only a sessionId, no resume
signal is available here. `"start"` is the correct literal because T3's re-detection rule already does the
right thing: it detects once per NEW sessionId and returns the memoized value (zero I/O) for every
subsequent idle beat on the SAME session. A resume of a genuinely-new opencode process yields a new
sessionId -> re-detect anyway; a resume that reuses the same sessionId in-process is (by T3 design) NOT
meant to re-probe on every idle. `"resume"` is intentionally NOT emitted from the heartbeat path - it is
reserved for an explicit resume edge, which this event layer does not currently expose. If a future todo
adds a real resume signal (distinct session.resumed event), that is where `"resume"` should be wired; T4
deliberately did not invent one. `"tool-exec"` stays owned by T7/T8's lazy-prime path, not the heartbeat.

Net for T11 live-e2e: a fresh `opencode` launch and an `opencode --continue` BOTH currently surface as
`"start"` here (each new process = new sessionId = one detect). There is no code path in T4 that emits
`"resume"`; do not expect a `"resume"`-triggered `[mailbox-mode] detected` from the heartbeat.

### Test gap that was caught + fixed (reviewer FAILED the first pass)
First submission changed the 4 source files but added ZERO tests. Fixed by:
- `presence-heartbeat-hook.test.ts` (+5 cases): detector external -> record mode:external + real url;
  detector internal -> record mode:internal + null url; detect() resolving AFTER a delay -> record reflects
  resolved mode on the post-detect beat (proves `.then(beat, beat)` actually re-writes, and that with a
  detector present NO beat happens before detect resolves); detect() rejecting -> beat still runs (proves
  internal sessions keep beating even on probe error). Existing "no detector" test stays green as the
  external-default legacy path.
- `create-mailbox-hooks.test.ts` (+2 cases): real end-to-end wiring - `buildPresenceHeartbeatHook` builds
  the REAL `createModeDetector` + REAL `defaultProbeSession` and hits a REAL local `Bun.serve` that returns
  `{ [sessionId]: {...} }` on `/session/status` -> record.mode==="external" + real serverUrl; and a ctx with
  no server url -> record.mode==="internal" + serverUrl null. No `mock.module`; the write is captured
  in-memory via the `writeRecord` override seam.

### GOTCHA: bun `os.homedir()` caches at process startup, ignores runtime `process.env.HOME`
My first wiring test set `process.env.HOME = mktempdir` and read the record back from
`presenceRecordPath(projectId, tmpHome)`. It FAILED (ENOENT) because `writePresenceRecord` defaults its
homeDir to `os.homedir()`, and bun snapshots homedir at startup - the record was written to the REAL
`~/.omo/presence/`, polluting it (had to `rm` two stray files). Do NOT rely on HOME redirection to isolate
presence writes inside a bun test process; inject `writeRecord`/`homeDir` explicitly (that is exactly why
the `PresenceHeartbeatOverrides` seam exists). T11's live e2e uses SEPARATE spawned processes, so HOME
override works there - this gotcha is specific to in-process bun unit tests.

### Verification
- `bun test presence-heartbeat-hook.test.ts create-mailbox-hooks.test.ts` -> 14 pass / 0 fail.
- `bun test packages/omo-opencode/src/features/cross-project-mailbox` -> 369 pass / 0 fail (no regression).
- `bun run typecheck` -> exit 0 (all workspace projects).
- `lsp_diagnostics` on all 6 touched files -> 0 diagnostics.
- Full `bun test` -> 10619 pass / 25 fail, ALL 25 unrelated pre-existing drift (Codex installer, model
  snapshots, workflow-summary audit, DMCA provenance, node-CLI build) - none touch mailbox/presence/event.
  Confirmed by stashing T4 and re-running the mailbox suite clean on base (369/0).
- Verified NO real `~/.omo/presence/` pollution after the fixed test run.


## [2026-07-04T08:27:06Z] Task: T5

Extended `presence-reader.ts` so a fresh internal-mode record reports a distinct `"internal"` status with ZERO I/O (no probe/fetch). Only `presence-reader.ts` + its test file touched.

### Final PresenceStatus union (canonical, for T6)
```ts
export type PresenceStatus = "live" | "stale" | "offline" | "internal"
```
`"internal"` is the new member. `readPresenceStatus(...)` (unchanged signature) returns it.

### Branch logic / ordering in `readPresenceStatus` (T6 consumes this exact order)
1. `record === null` -> `"offline"`.
2. `Date.now() - record.heartbeatTs > PRESENCE_TTL_MS` -> `"offline"` (stale heartbeat; runs BEFORE the mode branch so a stale internal record is `"offline"`, NEVER `"internal"`).
3. `record.mode === "internal"` -> `"internal"` (single-line short-circuit, NO probe call at all — proven by a fetch spy).
4. else (external) -> `raceProbe(record, deps.probeSession, timeoutMs)` -> `"live"` (probe true) / `"stale"` (probe false/absent/error/timeout). Unchanged T2 path.

### For T6 (TUI/outbound-budget rendering)
- The value T6 must map to the `internal (doc-drop)` label is the exact string literal `"internal"` returned by `readPresenceStatus`. It is a peer of `"live"|"stale"|"offline"`, so wherever T6 switches on `PresenceStatus`, add an `"internal"` arm.
- `readPresenceStatus` remains the single entry point (function name unchanged); no new export was added. `PresenceStatus` is already barrel-exported via presence/index.ts (unchanged).
- Consuming code that switches exhaustively on `PresenceStatus` will need an `"internal"` case; typecheck (tsgo exit 0) confirms no CURRENT consumer breaks — none does an exhaustive switch yet.

### Reused, not reimplemented
- External branch still calls the injected `deps.probeSession` (default `defaultProbeSession`, T2) through the existing `raceProbe` wrapper. No probing logic duplicated.

### Tests added (presence-reader.test.ts, all given/when/then)
- fresh internal record + injected probe spy -> `"internal"`, probe NOT called.
- fresh internal record + REAL default path with a `globalThis.fetch` spy -> `"internal"`, fetch NOT called (the plan's zero-I/O proof, using the production `defaultProbeSession`, not an injected stub).
- stale-heartbeat internal record -> `"offline"` (ordering proof: offline wins over internal).
- fresh external record + empty-map probe (returns false) -> `"stale"`, probe called once.

### Verification
- `bun test presence-reader.test.ts` -> 21 pass / 0 fail (4 new T5 cases).
- `bun test .../cross-project-mailbox` -> 379 pass / 0 fail (was 369 at T4; no regression).
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` -> exit 0.
- `lsp_diagnostics` on presence-reader.ts + test -> 0 diagnostics.


## [2026-07-04 02:29 PDT] Task: T6 (outbound-budget + TUI sidebar render internal / doc-drop)

### Final state at start
- T5 had ALREADY landed most of T6's `outbound-budget.ts` work (uncommitted in the worktree): `OutboundBudgetPresence = PresenceStatus | "unknown"` (so `"internal"` is already in the union via T5's `PresenceStatus`), `presenceLabel()` returning `"internal (doc-drop)"`, and `renderOutboundBudgetTable()` using it. `outbound-budget.test.ts` already covered internal mapping + no-regression. 13/13 pass.
- The injector (`outbound-budget-injector.ts`) renders internal TRANSITIVELY through `renderOutboundBudgetTable` + `readPresenceStatus`; NO functional change was needed there.

### Label string used (canonical)
- `internal (doc-drop)` — produced solely by `presenceLabel(presence)` in `outbound-budget.ts:9-11`. Do NOT hardcode this literal elsewhere; call `presenceLabel`.

### What T6 actually added
- `features/tui-sidebar/render-view.ts`: new exported `buildOutboundBudgetNodes(rows, theme)` + helpers `outboundBudgetRow` (two-column space-between box, label left via `theme.textMuted`, status right) and `presenceFg` (live->success, internal->info, stale->warning, offline/unknown->textMuted). Reuses `presenceLabel` + `OutboundBudgetRow` imported from `../cross-project-mailbox/visibility`. Matches the EXACT existing `mailboxCountRow` two-column convention (no border wrapper, `width:"100%"`, `flexDirection:"row"`, `justifyContent:"space-between"`).
- `render-view.test.ts`: 4 new given/when/then cases (internal doc-drop label + info fg; two-column structure for internal+non-internal; live/stale/offline/unknown unchanged; empty rows -> `[]`).
- `outbound-budget-injector.test.ts` (NEW file): drives the live `experimental.chat.messages.transform` hook end-to-end — internal target injects the doc-drop label; offline target injects `offline` and never `doc-drop`.

### Scope boundary (important for whoever wires the live sidebar later)
- `buildOutboundBudgetNodes` is production code but is NOT yet wired into the live sidebar slot. The live sidebar render path is `tui.ts` (slot) <- `render-view.ts` via `MailboxSidebarState` in `state-types.ts`, and `MailboxSidebarState` (from `sidebar/mailbox-sidebar.ts`) carries NO presence/outbound-budget data today — only aggregate counts. Threading per-target presence into the live sidebar requires editing `mailbox-sidebar.ts` + `state-types.ts` + the tui slot, all OUTSIDE T6's 3-file commit scope. Left for a follow-up wiring todo. T6 proves the render function's output directly.

### Live QA (evidence: .omo/evidence/20260704-mailbox-t6-tui/)
- `render-harness.ts` runs the REAL production functions against an isolated `mktemp` sandbox HOME (never host `~/.omo`): seeds a `mode:"internal"` record via real `writePresenceRecord`, reads back via real `readPresenceStatus(id, sandboxHome)` -> `"internal"` (zero HTTP probes), renders via real `buildOutboundBudgetNodes` + `renderOutboundBudgetTable` + live injector hook.
- Captured under tmux -> `tui-capture.txt` + `tui-screenshot.png`. Screenshot shows `internal (doc-drop)` in BOTH the sidebar rows and the injected/live table; `Beta Offline` -> `offline` (regression guard).
- Isolation verified: real `~/.omo/presence/` has no sandbox ids after run (`ISO_OK`).

### Verification
- `bun test tui-sidebar/ + visibility/` -> 99 pass / 0 fail / 246 expect().
- `bun run typecheck` (full, tsgo all packages) -> exit 0.
- `lsp_diagnostics` on render-view.ts, render-view.test.ts, injector test, harness -> 0 diagnostics.


## [2026-07-04T09:44:34Z] Task: T7

New file `send-tool/project-note-tool.ts` (+ send-tool barrel, tools barrel, factories, registry). Fire-and-forget doc-drop sibling of `project_message`. Mirrors project-message-tool exactly minus presence probe + launch.

### Exact exports (canonical, for T8 consistency)
```ts
export const NOTE_EXTERNAL_GUIDANCE = "external session; use project_message"
export type ProjectNoteExecResult = SendResult | { blocked: true; reason: string }  // SendResult reused from project-message-tool
export function createProjectNoteInputSchema(maxBodyBytes: number)   // strict zod, no `mode`/`list` field (drop-only, no list mode)
export const ProjectNoteInputSchema
export interface ProjectNoteToolDeps { config, thisProjectId, thisRepoRoot, thisProjectDisplayName, registry, modeDetector, writeNote?, appendOutbox? }
export async function runProjectNoteSend(input: SendInput, deps): Promise<SendResult>
export async function resolveNoteMode(modeDetector, sessionId): Promise<MailboxModeState>
export function createProjectNoteTool(deps: ProjectNoteToolDeps): ToolDefinition
```
Tool name registered: **`project_note`**. Factory export name: **`createProjectNoteTool`**.

### Deps interface shape (KEY for T8)
`ProjectNoteToolDeps` reuses `ProjectMessageRegistry` + `SendResult` from project-message-tool. It DROPS `readPresence`/`launchTarget`/`launchPermissionAsk` (never imported `launchTargetSession`, `readPresenceStatus`, or `maybeLaunchOfflineTarget`) and ADDS one field:
```ts
modeDetector: Pick<ModeDetector, "currentMode" | "detect">
```
This is the CANONICAL injection contract. **T8 must add the SAME `modeDetector: Pick<ModeDetector, "currentMode" | "detect">` field to `ProjectMessageToolDeps`** so both tools inject the detector identically. Use `Pick<...>` (not the full `ModeDetector`) so tests inject a 2-method spy.

### Mode gating + lazy-detect (the exact pattern T8 mirrors)
- `resolveNoteMode(modeDetector, sessionId)`: read `currentMode()` (zero I/O memoized). If `!== "unknown"` return it. Else `await detect(sessionId, "tool-exec")`. This is the whole lazy-fallback; T8 should call the identical helper shape.
- Ordering in `execute`: fresh-config -> `enabled===false` guard -> **mode gate (external short-circuits with guidance) BEFORE body-cap and BEFORE preflight** -> body-cap -> `inputSchema.parse` -> `runProjectNoteSend` (which runs preflight then write then outbox). External never touches preflight/write. This satisfies the plan's "fail BEFORE preflight" for external.
- `sessionId` read from execute's 2nd arg: `(toolContext as { sessionID?: string })?.sessionID ?? ""`. Same pattern monitor tools use (`ctx.sessionID`).

### Guard parity (retained vs removed)
- RETAINED: `runSendPreflight` (allowlist + intent-budget + hop-check via `built.envelope.hopCount`), `buildSendEnvelope`, body-cap `min(config.bounds.max_body_bytes, MAX_BODY_BYTES)`, `appendOutboxLog`, fresh-config reload via `validatePluginConfig`, `MailboxStore.writeNote` (target `coordination_notes/<fromProjectId>/`).
- REMOVED: presence probe, `maybeLaunchOfflineTarget`, launch deps. No `mode:"list"` branch (project_note is send-only).

### Registry wiring (tool-registry-mailbox-tools.ts)
- BOTH `project_message` + `project_note` register whenever `config.enabled` (mode split is execution-time, not registration-time). One shared `createModeDetector({ resolveServerUrl: () => ctx.serverUrl?.toString() ?? getServerBaseUrl(ctx.client), repoRoot, probe: defaultProbeSession })` instance passed to project_note so both tools stay on one memoized mode. `createMailboxToolsRecord` gained optional `modeDetector` arg (test seam) + `createProjectNoteTool` in its `factories` Pick.
- Factories: added `createProjectNoteTool` to `ToolRegistryFactories` type + `defaultToolRegistryFactories`.
- NOTE for T8: project_message currently gets `sharedDeps` WITHOUT the detector. T8 must thread the SAME `modeDetector` into project_message's deps here too (add it to `sharedDeps` or a message-specific spread) so both tools share the one instance.

### Verification
- `bun test project-note-tool.test.ts` -> 7 pass / 0 fail (internal happy: note file + frontmatter + outbox; no-presence/launch deps assertion; external blocked writes nothing + no outbox file; unknown lazy-detect->internal proceeds with exactly one `tool-exec` detect; unknown lazy-detect->external blocks; preflight unauthorized blocked no write; preflight over-budget blocked no write).
- `bun test .../cross-project-mailbox` -> 392 pass / 0 fail (was 379 at T5/T6; +13 incl. 7 new note tests, no regression).
- `bun test .../plugin/` -> 327 pass / 0 fail (registry wiring clean).
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` -> exit 0.


## [2026-07-04T09:56:09Z] Task: T8

Gated `project_message` send to external mode. Only 4 files touched (message tool + its test + send-tool barrel + registry wiring). project-note-tool.ts NOT modified.

### Deps field added (matches T7 contract EXACTLY)
`ProjectMessageToolDeps` gained `modeDetector?: Pick<ModeDetector, "currentMode" | "detect">` — same type shape as `ProjectNoteToolDeps.modeDetector`, but OPTIONAL here (T7's is required). Optional is the backward-compat mechanism: pre-existing send fixtures never inject a detector.

### Default (backward-compat) detector
Module-level const `EXTERNAL_DEFAULT_MODE_DETECTOR: Pick<ModeDetector, "currentMode" | "detect">` = `{ currentMode: () => "external", detect: async () => "external" }`. In `execute`, `deps.modeDetector ?? EXTERNAL_DEFAULT_MODE_DETECTOR`. Result: every pre-existing `project-message-tool.test.ts` test (realDeps/spyDeps/launchSpyDeps none inject a detector) resolves `external` -> send path unchanged -> all pass UNMODIFIED. Confirmed: zero edits to any pre-existing test (only appended a new `describe` block + one import line).

### Mode gate placement (send path only)
`execute` ordering: fresh-config -> `enabled===false` guard -> **`mode:"list"` branch (returns BEFORE the gate, so list works in BOTH modes)** -> mode gate -> body-cap -> parse -> send. The gate sits AFTER the list return and BEFORE body-cap. Internal -> `{ blocked:true, reason:"internal session - use project_note" }` (const `MESSAGE_INTERNAL_GUIDANCE`), no presence/write/launch/append. `sessionID` read from `execute`'s 2nd arg `(toolContext as { sessionID?: string })?.sessionID ?? ""` (added `toolContext` param to the previously 1-arg `execute`).

### resolveSendMode helper (duplicated, NOT imported from project-note-tool)
`export async function resolveSendMode(modeDetector, sessionId)`: `currentMode()` first; if `!== "unknown"` return it; else `detect(sessionId, "tool-exec")`. Identical shape to T7's `resolveNoteMode`. DID NOT import `resolveNoteMode` from project-note-tool because project-note-tool.ts already imports `SendResult`/`ProjectMessageRegistry` FROM project-message-tool.ts — importing back would create a circular import. A 6-line duplicate is cleaner than extracting a new shared module (plan said don't over-engineer). Both live in send-tool/ and are barrel-exported.

### Shared detector wiring (tool-registry-mailbox-tools.ts)
The registry ALREADY built one shared `createModeDetector(...)` instance (T7 added it for project_note). ONE-line change: `project_message: messageFactory({ ...sharedDeps, modeDetector })` (was `messageFactory(sharedDeps)`). Now BOTH `project_message` and `project_note` receive the SAME detector instance -> both observe one memoized session mode. No new detector construction, no sharedDeps change needed.

### New barrel exports (send-tool/index.ts)
Added `MESSAGE_INTERNAL_GUIDANCE` + `resolveSendMode` to the project-message-tool export block (mirrors T7 exporting `NOTE_EXTERNAL_GUIDANCE` + `resolveNoteMode`).

### Tests added (project-message-tool.test.ts, appended describe block "internal/external mode gate", 5 cases)
- internal send -> blocked with exact reason, zero write/outbox/presence/launch (spies), no outbox file on disk.
- external send -> unchanged (ok, writeCalls 1, outboxCalls 1).
- unknown mode -> lazy `detect(sessionId, "tool-exec")` called once, blocks on internal.
- `mode:"list"` in internal mode -> returns advisory rows, `detectCalls` empty (gate never runs for list).
- no detector injected -> defaults external -> ok (backward-compat proof).
Reused `fixedModeDetector`/`lazyModeDetector`/`ModeSpy` helpers shaped like project-note-tool.test.ts's.

### Verification
- `bun test .../send-tool/` -> 50 pass / 0 fail (was 45 pre-T8; +5 new, all pre-existing green UNMODIFIED).
- `bun test .../cross-project-mailbox .../plugin` -> 1007 pass / 0 fail (no regression).
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` -> exit 0.
- `lsp_diagnostics` on all 4 touched files -> 0 diagnostics.

## [2026-07-04T10:15:00Z] Task: T9

Added a focused test file `presence/mode-detector-logging.test.ts` to assert the exact log lines emitted by `mode-detector.ts` on start, resume, and transition.

### Exact log message strings asserted
- `[mailbox-mode] detected` with payload `{ mode, sessionId, trigger, reason }`
- `[mailbox-mode] transition` with payload `{ from, to, sessionId }`

### Test cases implemented
- **Fresh start trigger (external)**: Emits `[mailbox-mode] detected` with `mode: "external"`, `trigger: "start"`, `reason: "session-live"`. No transition log.
- **Fresh start trigger (internal)**: Emits `[mailbox-mode] detected` with `mode: "internal"`, `trigger: "start"`, `reason: "no-server-url"`. No transition log.
- **Resume trigger (unchanged mode)**: Emits `[mailbox-mode] detected` with `trigger: "resume"`. No transition log.
- **Resume trigger (changed mode)**: Emits `[mailbox-mode] detected` with `trigger: "resume"` AND `[mailbox-mode] transition` with `from: "external"`, `to: "internal"`.

### Verification
- `bun test packages/omo-opencode/src/features/cross-project-mailbox/presence/mode-detector-logging.test.ts` -> 4 pass / 0 fail.
- `bun run typecheck` -> exit 0.
- `lsp_diagnostics` -> clean.

## [2026-07-04T10:15:00Z] Task: T10

Updated user-facing documentation to reflect the new internal/external mode feature.

### Exact locations
- `docs/reference/cross-project-mailbox.md`: Updated "Session Presence" section to document internal vs external modes, the new fields (`mode` and nullable `serverUrl`), the self-probe mechanism, and directory-scoped probing. Updated "Step 3: Driving Delivery" to document the `project_note` tool, its schema, mode gating behavior, and guard parity, as well as `project_message`'s new gating behavior.
- `docs/reference/hooks-and-tools.md`: Updated the `project_message` tool entry and added the `project_note` tool entry under "Conditional / Gated Tools" to document their mode-gating behavior and era added.

### Verification
- Verified that all documented tool names, field names, and guidance strings match the learnings notepad exactly.
- Verified that no em/en dashes or AI slop words were introduced.

## [2026-07-05T12:00:00Z] Cleanup

The internal/external mode gate was proven correct via live e2e evidence (`.omo/evidence/20260705-mailbox-internal-external-v10-debug/`), and debug logging removed as final cleanup.
