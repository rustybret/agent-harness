# project-message-iteration - Work Plan

## TL;DR (For humans)

**What you'll get:** A working cross-project mailbox. Today the idle-drain hook has *never fired in
production* (a dead-cache wiring bug), so no project has ever auto-drained a note - this fixes that root
cause first. Then: a simplified 3-tier permission model (question / impl / plan) mapped to omo task
categories, so a project can request "a quick fix" or "a full feature" from another project and the
receiver's config authorizes it; sending agents can *see their outbound authority before they send* and
whether the target session is even alive; a sender-side launch policy (default off) that can ask you for
permission to boot an offline target session; project_message baked into the core agent prompts as a
first-class task flow; and a TUI mailbox panel pinned above Magic Context in a clean two-column layout.

**Why this approach:** The drain bug is the linchpin - every other symptom (stuck "pending" outbox, both
inboxes at processed/=0) cascades from it, so C1 lands first and standalone. The permission rework reuses
omo's own category taxonomy instead of inventing a parallel one. Presence + launch are split so the
low-risk presence detection can ship even if headless-launch proves heavy.

**What it will NOT do:** No auto-launching of sessions without your explicit opt-in (default is
send-only). No new network daemon - presence is a heartbeat file plus a call to the target's own already-
running OpenCode server. Prometheus stays out of the send/intake loop. No changes to the on-disk note
wire format beyond an optional `category` field.

**Effort:** ~14 todos across 8 waves. **Risk:** Medium - touches a shipped feature's runtime, config
schema, TUI, and agent prompts; mitigated by TDD + a full permission-combination matrix + a live
opencode-qa e2e with recorded evidence.

**Decisions (all locked with you):** category-gated 3-tier permissions; presence via a published
heartbeat record + the target's server API; inject-and-probe visibility; primaries-minus-Prometheus
prompt integration; launch_policy disabled|ask|auto (default disabled) modeled on the .env-permission
prompt; TUI mailbox as its own slot above Magic Context; $schema pointer to the agent-harness asset.

## Scope

### IN
- **C1** Fix the drain root cause: `resolveActivePrimaryAgent` reads the dead `agentPrimaryCache`
  (never populated in prod). Redirect it to the live `getSessionAgent` store with config-key
  canonicalization; delete the dead cache.
- **C2** Collapse the 6-value intent ladder to 3 tiers (question < impl < plan) with a legacy-value
  migration; add optional `category` to the envelope + tool; add CATEGORY_TIER + AGENT_TIER maps; gate
  `requiredTier(category ?? intent) <= grantedCeiling(sender)`.
- **C3** Advisory outbound-budget visibility: passive injected table (allowed targets + ceiling +
  live/offline) and a read-only probe mode on the mailbox tool.
- **C4a** Session presence: heartbeat record `~/.omo/presence/<projectId>.json`; liveness confirmed via
  the target's published server API.
- **C4b** Launch policy `disabled|ask|auto` (default `disabled`), sender-side, modeled on the
  .env-permission ask surface; on `ask`/`auto`, spawn a headless server in the target repo.
- **C5** Prompt integration: cross-project flow + acceptance text into Sisyphus, Atlas, Hephaestus and
  the shared delegate-task/category contract. Prometheus excluded.
- **C6** TUI: mailbox as its own sidebar slot ordered above Magic Context (order 150 < 200); two-column
  label/count layout.
- **C7** `$schema` pointer + schema regen covering the new config params; migrate the in-repo project
  config(s).
- **C8** TDD unit coverage + a full permission-combination matrix + a live opencode-qa e2e with evidence.

### OUT
- No changes to the atomic reservation / processed / rejected on-disk protocol beyond additive fields.
- No preemption of busy sessions (idle-drain policy unchanged; interrupt_policy work is not in scope).
- No migration of external-machine project configs to machine-local schema paths.
- No Prometheus prompt changes; no receiver-side "may I be launched" opt-in (launch is sender authority).
- The 7 envelope-less manual file-drops in existing inboxes are NOT retro-parsed (documented as
  read-manually artifacts).

## Verification strategy

- **TDD:** every todo writes failing tests first, then code. Bun test, co-located `*.test.ts`,
  given/when/then.
- **Permission matrix (C8):** a table-driven test enumerating every (requested category|intent x granted
  ceiling) pair asserting accept/reject, on BOTH the advisory sender preflight and the authoritative
  inbound validation.
- **Static audits:** `prompt-async-route-audit` and comment-checker must stay green; no `as any`, no
  empty catch, no em-dashes.
- **Live e2e (mandatory, the done-bar):** an isolated `opencode-qa` run in an XDG sandbox driving two
  real sessions (sender + receiver) proving a note delivered by `project_message` auto-drains after the
  C1 fix, with SSE hook-fired proof, before/after mailbox files, and a TUI screenshot of the two-column
  panel above Magic Context. Evidence under `.omo/evidence/<YYYYMMDD>-project-message-iteration/`.

## Execution strategy

Task-owned git worktree under `.local-ignore/worktrees/project-message-iteration` on branch
`feat/project-message-iteration`. Waves:

- **Wave 1 (T1)** - C1 drain fix. Standalone unlock; everything else builds on a working drain.
- **Wave 2 (T2, T3)** - C2 taxonomy core (T2) + envelope/tool category field (T3). T3 depends on T2.
- **Wave 3 (T4)** - C3 advisory visibility + probe. Depends on T2.
- **Wave 4 (T5)** - C4a presence heartbeat + liveness. Independent of T2; depends on T1 for wiring point.
- **Wave 5 (T6)** - C4b launch policy. Depends on T5 (needs presence to decide "offline").
- **Wave 6 (T7)** - C5 prompt integration. Depends on T2 (references the tier vocabulary).
- **Wave 7 (T8, T9)** - C6 TUI own-slot ordering (T8) + two-column format (T9). T9 depends on T8.
- **Wave 8 (T10, T11)** - C7 schema regen (T10) + config migration (T11). T11 depends on T10.
- **Wave 9 (T12)** - C8 permission-combination matrix (depends on T2, T3, T4).
- **Wave 10 (T13)** - C8 live opencode-qa e2e (depends on ALL prior).
- **Wave 11 (T14)** - docs update (hooks-and-tools.md + cross-project-mailbox.md).

### Dependency matrix
| Todo | Depends on | Blocks |
|------|-----------|--------|
| T1 | - | T5, T13 |
| T2 | - | T3, T4, T6, T12 |
| T3 | T2 | T12, T13 |
| T4 | T2 | T12, T13 |
| T5 | T1 | T6(launch), T13 |
| T6 | T5 | T13 |
| T7 | T2 | T13 |
| T8 | - | T9, T13 |
| T9 | T8 | T13 |
| T10 | T2, T5, T6 | T11, T13 |
| T11 | T10 | T13 |
| T12 | T2, T3, T4 | T13 |
| T13 | ALL | T14 |
| T14 | T13 | - |

## Todos

### T1 - Fix the drain root cause (collapse dead agentPrimaryCache into getSessionAgent)
**WHERE:** `packages/omo-opencode/src/features/cross-project-mailbox/primary-resolver/resolver.ts`,
its barrel, `hooks/idle-drain-hook.ts`; read `plugin/chat-message/session-model.ts`,
`features/claude-code-session-state/state.ts`.
**WHAT:** `resolveActivePrimaryAgent(sessionId)` currently reads `agentPrimaryCache` (a Map fed only by
`.observe()`, which NO production code calls - drain never fires). Redirect it to read the live store via
`resolveRegisteredAgentName(getSessionAgent(sessionId))` and canonicalize with `getAgentConfigKey` before
the `intake_eligible_agents` comparison in `isEligiblePrimary`. Delete `agentPrimaryCache` + `.observe()`
+ its tests (dead code) unless another consumer exists (grep to confirm none).
**References:** `resolver.ts` (agentPrimaryCache, resolve, observe); `idle-drain-hook.ts:16-18,178-180`
(isEligiblePrimary gate); `state.ts:55-101` (resolveRegisteredAgentName, getSessionAgent);
`shared/agent-display-names.ts:122` (getAgentConfigKey); `chat-message/session-model.ts:12`
(updateSessionAgent path proving getSessionAgent is populated).
**Acceptance criteria (agent-executable):**
- `grep -rn "agentPrimaryCache\|\.observe(" packages/omo-opencode/src` returns ZERO non-test hits after
  the change (dead cache removed) OR a documented live consumer.
- New unit test: given `updateSessionAgent(sid, "Sisyphus (Ultraworker)")` and
  `intake_eligible_agents:["sisyphus"]`, `resolveActivePrimaryAgent(sid)` returns a value that makes
  `isEligiblePrimary` true.
- `bun test packages/omo-opencode/src/features/cross-project-mailbox` green.
**QA happy:** unit test proving drain-eligibility resolves for config-key, display-name, and legacy
parenthesized name. Evidence: `.omo/evidence/<date>-project-message-iteration/t1-drain-unit.txt`.
**QA failure:** given an ineligible primary (e.g. active agent `hephaestus`, eligible `["sisyphus"]`),
drain still fail-closes (no injection). Evidence: same dir, `t1-drain-negative.txt`.
**Commit:** `fix(mailbox): drain reads live session-agent store, not dead agentPrimaryCache`

### T2 - Collapse intent ladder to 3 tiers with legacy migration + category/agent tier maps
**WHERE:** `packages/omo-opencode/src/features/cross-project-mailbox/config.ts`,
`envelope/schema.ts`, `validate-inbound.ts`, `send-preflight.ts`; new `permission-tiers.ts`.
**WHAT:** Define the canonical 3-tier order `question < impl < plan`. Add `permission-tiers.ts` exporting
`TIER_ORDER`, `LEGACY_INTENT_MAP` (`quick->impl`, `review->plan`, `work-loop->plan`, identity for the 3),
`CATEGORY_TIER` (builtin categories -> tier: quick/unspecified-low -> impl; deep/ultrabrain/
unspecified-high/visual-engineering/artistry/writing -> plan), and `AGENT_TIER` (explore/librarian/oracle/
metis/momus -> question). Config `intent_budget` accepts the 3 tiers going forward but the loader maps
legacy values through `LEGACY_INTENT_MAP`. Envelope `parseEnvelope` KEEPS accepting all 6 legacy intent
strings at the parse boundary, then canonicalizes to a 3-tier value AFTER parse (old queued notes never
stranded). `withinBudget` / inbound `INTENT_LADDER` use `TIER_ORDER`. Do NOT shrink the parse-gate enum.
**References:** `config.ts:4-19` (SenderConfigSchema.intent_budget); `envelope/schema.ts:8,41-49`
(MAILBOX_INTENTS, parseEnvelope); `validate-inbound.ts:5,74-79` (INTENT_LADDER, gate);
`send-preflight.ts:44-46` (withinBudget); `config/schema/categories.ts:30-39` (builtin category names);
`shared/agent-display-names.ts` (agent name list).
**Acceptance criteria:**
- Unit: `LEGACY_INTENT_MAP` maps quick->impl, review->plan, work-loop->plan; identity for question/impl/plan.
- Unit: a config with `intent_budget:"quick"` loads and behaves as `impl`.
- Unit: an old envelope with `intent:"work-loop"` parses and canonicalizes to `plan` (not rejected).
- Unit: `requiredTier(category)` returns the mapped tier for every builtin category + listed agent;
  unknown -> throws/reject.
- `bun test` for the feature dir green.
**QA happy:** table test of legacy + new values resolving correctly. Evidence: `t2-tier-map.txt`.
**QA failure:** unknown category `"frobnicate"` -> preflight reject with clear reason. Evidence:
`t2-unknown-category.txt`.
**Commit:** `feat(mailbox): 3-tier permission model with legacy intent migration + category tier maps`

### [x] T3 - Add optional `category` to envelope + project_message tool; gate on required tier
**WHERE:** `envelope/schema.ts`, `send-tool/project-message-tool.ts`, `send-preflight.ts`,
`validate-inbound.ts`.
**WHAT:** Add optional `category` (string) to the envelope schema and the tool input schema. Gate rule:
`requiredTier(category ?? intent) <= grantedCeiling(sender)` on BOTH the sender advisory preflight and the
authoritative inbound validation. Preserve back-compat: notes without `category` gate on `intent` exactly
as today. Body-size precheck must use `Buffer.byteLength(body,"utf8")` to match the serialization cap.
**References:** `envelope/schema.ts:6,8,31-49`; `send-tool/project-message-tool.ts:17-25,135-158`
(arg schema + rawBody.length precheck); `send-preflight.ts:20-46`; `validate-inbound.ts:38-79`;
`permission-tiers.ts` (from T2).
**Acceptance criteria:**
- Unit: tool accepts `category:"quick"` and sets it on the envelope; omitting it still validates.
- Unit: `category:"deep"` with sender ceiling `impl` -> rejected on preflight AND on inbound.
- Unit: `category:"quick"` with sender ceiling `impl` -> accepted.
- Unit: multibyte body (Korean/emoji) at the byte boundary is measured by utf8 bytes, not string length.
**QA happy:** category-bearing send accepted within ceiling. Evidence: `t3-category-accept.txt`.
**QA failure:** category over ceiling rejected with the required-vs-granted tier in the message. Evidence:
`t3-category-reject.txt`.
**Commit:** `feat(mailbox): optional category on envelope+tool, gated by required tier`

### T4 - Advisory outbound-budget visibility (injected table + probe mode)
**WHERE:** new `visibility/outbound-budget.ts`; `send-tool/project-message-tool.ts` (probe mode);
a transform/session hook for injection (`plugin/hooks/create-mailbox-*-hooks.ts`).
**WHAT:** Build a sender-local advisory view: for each allowed target in the sender's config allowlist,
compute `{ targetProjectId, displayName, grantedCeiling, presence: live|stale|offline }` (presence from
T5 reader; if T5 not merged yet, presence = "unknown"). Inject a compact table into context at session
start and on idle, **only when it changed** (hash guard) and capped at N targets. Add a read-only probe
mode to `project_message` (e.g. `mode:"list"`) returning the same structure without sending. Mark clearly
as ADVISORY (target-side inbound validation remains authoritative).
**References:** `config.ts:47-51` (receivers/allowlist shape); `registry/project-registry.ts:121-148`
(registry lookups); `send-tool/project-message-tool.ts` (add mode); `mailbox-sidebar.ts` (existing
read patterns); presence reader from T5.
**Acceptance criteria:**
- Unit: outbound-budget for a config with 2 allowed targets returns 2 rows with correct ceilings.
- Unit: probe mode returns rows and performs NO write (no outbox entry created).
- Unit: injection is skipped when the computed table hash is unchanged.
**QA happy:** probe lists allowed targets + ceilings. Evidence: `t4-probe.txt`.
**QA failure:** a target NOT in the allowlist is absent from the table and probe. Evidence:
`t4-not-allowed.txt`.
**Commit:** `feat(mailbox): advisory outbound-budget table (injected + probe mode)`

### [x] T5 - Session presence heartbeat + liveness via target server API
**WHERE:** new `presence/presence-record.ts` + `presence/presence-reader.ts`; a session hook to
write/refresh the heartbeat + clear on dispose.
**WHAT:** Each session writes `~/.omo/presence/<projectId>.json` atomically (tmp+rename, mode 0600) with
`{ projectId, repoRoot, serverUrl, sessionId, pid, heartbeatTs }`, refreshed every 10s. `serverUrl` from
`getServerBaseUrl(client)` (`shared/opencode-http-api.ts:49`). Reader: presence = `live` iff file
heartbeat within TTL (30s) AND the published `serverUrl` answers `session.get(sessionId)` within 2s;
`stale` iff file fresh but API unreachable; `offline` iff no/expired file. Multi-session same projectId =
last-writer-wins. Clear the file on dispose.
**References:** `shared/opencode-http-api.ts:49-86` (getServerBaseUrl); `features/background-agent/
session-existence.ts:39-58` (checkSessionExistence pattern for session.get); `registry/
project-registry.ts` (projectId source); `plugin/hooks/create-mailbox-session-hooks.ts` (hook wiring).
**Acceptance criteria:**
- Unit: writer produces a well-formed record; atomic (no partial file observable).
- Unit: reader returns `live` for fresh file + stubbed OK `session.get`; `stale` for fresh file +
  failing API; `offline` for missing/expired file.
- Unit: TTL/interval constants are the single source (30s/10s) and used by both writer and reader.
**QA happy:** live session detected via presence + API probe. Evidence: `t5-presence-live.txt`.
**QA failure:** expired heartbeat -> offline; stubbed unreachable serverUrl -> stale. Evidence:
`t5-presence-offline.txt`.
**Commit:** `feat(mailbox): session presence heartbeat + server-API liveness`

### T6 - Launch policy (disabled|ask|auto) with injected permission callback
**WHERE:** `config.ts` (add `launch_policy`), new `launch/launch-target.ts`;
`send-tool/project-message-tool.ts` (deps: injected `launchPermissionAsk`).
**WHAT:** Add sender-side `launch_policy: "disabled"|"ask"|"auto"` (default `"disabled"`). On a send to an
`offline` target (per T5): `disabled` -> no launch, no prompt, message queued for next idle drain (current
behavior); `ask` -> call an injected `launchPermissionAsk(target)` callback (pattern:
`monitor/permission.ts` bashPermissionAsk); on allow, spawn a headless server in the target repo; `auto`
-> spawn without asking. Isolated launch helper: choose command, cwd=target repoRoot, detached, log path,
never block the send indefinitely (timeout). NO real user-config coupling - permission comes through the
injected callback.
**References:** `config.ts` (schema); `monitor/permission.ts:1-11,57-80` (bashPermissionAsk injected
pattern); `shared/spawn-with-windows-hide.ts:75` (spawn helper); `cli/run/server-connection.ts` +
`shared/port-utils.ts` (server/port patterns); T5 presence reader (offline decision).
**Acceptance criteria:**
- Unit: `disabled` -> no launch, no callback invoked, message queued.
- Unit: `ask` + callback returns deny -> no launch; `ask` + allow -> launch invoked once.
- Unit: `auto` -> launch invoked without callback.
- Unit: online target -> launch path never entered regardless of policy.
**QA happy:** `ask`+allow launches target (mocked spawn). Evidence: `t6-launch-ask-allow.txt`.
**QA failure:** `disabled` never launches, never prompts. Evidence: `t6-launch-disabled.txt`.
**Commit:** `feat(mailbox): sender-side launch_policy disabled|ask|auto via injected permission`

### [x] T7 - Prompt integration (Sisyphus, Atlas, Hephaestus + shared task contract; NOT Prometheus)
**WHERE:** the three agent factories under `packages/omo-opencode/src/agents/`; the shared
delegate-task/category contract prompt under `packages/prompts-core/` or
`tools/delegate-task/*prompt*`.
**WHAT:** Add a concise "Cross-project requests" section: how to read the advisory outbound-budget, how to
send via `project_message` with an appropriate `category`/tier, that acceptance criteria for a task may
include a cross-project request/response, and that an offline target obeys `launch_policy`. Keep it tight
(high signal, low token cost). Prometheus is explicitly excluded (planner stays out of the send/intake
loop, consistent with the `prometheus-md-only` guard). Remove any `prometheus-plan` pseudo-token from the
taxonomy schema (conceptual only).
**References:** `agents/` Sisyphus/Atlas/Hephaestus factories; `tools/delegate-task/` category prompt
appends (`CATEGORY_PROMPT_APPENDS`); `permission-tiers.ts` (vocabulary); the `prometheus-md-only` hook
(rationale for exclusion).
**Acceptance criteria:**
- The three named agents' prompts contain the cross-project section; Prometheus's does NOT.
- No schema/config token named `prometheus-plan`/`atlas-work-loop`/`direct-answer` remains.
- Prompt snapshot tests (if present) updated; `bun test` green.
**QA happy:** grep confirms section present in the 3 agents, absent in Prometheus. Evidence:
`t7-prompt-presence.txt`.
**QA failure:** Prometheus prompt unchanged (no cross-project send instructions). Evidence:
`t7-prometheus-excluded.txt`.
**Commit:** `feat(mailbox): project_message as first-class task flow in core agent prompts`

### [x] T8 - TUI: mailbox as its own sidebar slot ordered above Magic Context
**WHERE:** `packages/omo-opencode/src/tui.ts` (slot registration), `compute-view.ts`, `render-view.ts`.
**WHAT:** Extract the mailbox section from the shared omo slot (order 900) into its OWN `registerSlot`
with `order: 150` (Magic Context DEFAULT_SLOT_ORDER = 200, verified in
`magic-context/.../tui-preferences.ts:67`), so it sorts above Magic Context. Keep collapse-state
persistence intact. Ensure both active and idle views render the mailbox via the new slot, not the old
appended section.
**References:** `tui.ts:30-54,183` (registerSlot, order:900); `render-view.ts:38-54,228-307`
(buildViewNodes mailbox section); `compute-view.ts` (mailbox threading);
`/Volumes/Topper2TB/Git/magic-context/packages/plugin/src/shared/tui-preferences.ts:66-67`
(PLUGIN_KEY, DEFAULT_SLOT_ORDER=200).
**Acceptance criteria:**
- Unit/slot-order test: with a mocked external slot at order 200, the mailbox slot (150) sorts above it.
- Mailbox no longer rendered as the trailing section of the omo slot.
- `bun test` for tui/render green.
**QA happy:** slot-order test asserts mailbox above a 200 slot. Evidence: `t8-slot-order.txt`.
**QA failure:** with collapse persisted, re-render keeps the mailbox slot position. Evidence:
`t8-collapse-persist.txt`.
**Commit:** `feat(mailbox): dedicated TUI sidebar slot ordered above Magic Context`

### T9 - TUI: two-column label/count layout
**WHERE:** `render-view.ts` (mailbox line builders).
**WHAT:** Replace the single-line strings (`in X unread Y done`, `out X pending Y read Z fail`) with a
two-column layout: label left (in, unread, done, out, pending, fail), count right. Define "done" =
processed-on-disk semantics in the label. Cover collapsed (summary line), all-zero ("Mailbox idle"),
inbound-only, and outbound-fail states.
**References:** `render-view.ts:270-307` (current mailboxLines); existing mailbox render tests;
`mailbox-store.ts:201-214` (processed/done semantics).
**Acceptance criteria:**
- Snapshot tests for: active, idle, collapsed, all-zero, inbound-only, outbound-fail - each asserting the
  exact two-column label/count text.
- Zero-state still shows "Mailbox idle".
**QA happy:** two-column snapshot matches for a populated state. Evidence: `t9-two-column.txt`.
**QA failure:** all-zero renders "Mailbox idle", not empty columns. Evidence: `t9-idle.txt`.
**Commit:** `feat(mailbox): two-column label/count TUI layout`

### T10 - Regenerate schema for new config params + $schema coverage
**WHERE:** `packages/omo-opencode/src/config/schema/*` (mailbox schema), `assets/oh-my-opencode.schema.json`.
**WHAT:** Ensure the cross-project-mailbox config schema includes `launch_policy` and the 3-tier
`intent_budget` (with legacy acceptance documented), then regenerate `assets/oh-my-opencode.schema.json`
via the schema build path. Verify the generated enum lists the 3 tiers and `launch_policy` values.
**References:** `config.ts` (updated schema from T2/T6); `assets/oh-my-opencode.schema.json` (generated);
`AGENTS.md` build:schema note (`bun run build:schema` - if no shell, describe the exact command for the
executor).
**Acceptance criteria:**
- `assets/oh-my-opencode.schema.json` contains `launch_policy` with enum
  `["disabled","ask","auto"]` and `intent_budget` covering the 3 tiers.
- Schema validates the in-repo `.opencode/oh-my-openagent.jsonc` without error.
**QA happy:** regenerated schema diff shows the new params. Evidence: `t10-schema-diff.txt`.
**QA failure:** an invalid `launch_policy:"bogus"` fails schema validation. Evidence:
`t10-schema-reject.txt`.
**Commit:** `chore(mailbox): regenerate config schema for launch_policy + 3-tier intent`

### T11 - Migrate in-repo project config(s): $schema pointer + new params
**WHERE:** `.opencode/oh-my-openagent.jsonc` (this repo) and any other in-repo project config that
carries `cross_project_mailbox`.
**WHAT:** Point `$schema` at the agent-harness asset for in-repo dev configs; update `intent_budget`
values to the 3-tier vocabulary (migrating legacy `quick`->`impl` etc.); add `launch_policy` where
appropriate (default `disabled`, so omission is fine). DO NOT rewrite external-machine project configs to
machine-local schema paths. List each edited path with a backup note.
**References:** `.opencode/oh-my-openagent.jsonc`; `features/cross-project-mailbox/auto-provision.ts:11-37`
(local-vs-remote schema selection); T10 schema.
**Acceptance criteria:**
- In-repo config `$schema` resolves to the agent-harness asset and validates.
- Any legacy `intent_budget` value migrated to a 3-tier value.
- External project configs untouched by this todo.
**QA happy:** config loads with no schema/Zod warning. Evidence: `t11-config-valid.txt`.
**QA failure:** a deliberately-broken tier value is caught by validation. Evidence: `t11-config-reject.txt`.
**Commit:** `chore(mailbox): migrate in-repo config to 3-tier + agent-harness $schema`

### T12 - Permission-combination test matrix (every category|intent x ceiling)
**WHERE:** new `permission-matrix.test.ts` in the feature dir.
**WHAT:** Table-driven test enumerating every (requested subject in {3 intents + all builtin categories +
listed agents} x granted ceiling in {question, impl, plan}) asserting the expected accept/reject on BOTH
the advisory sender preflight AND the authoritative inbound validation. Include legacy-value inputs
(quick/review/work-loop) proving they canonicalize before gating.
**References:** `permission-tiers.ts` (T2), `send-preflight.ts`, `validate-inbound.ts`, T3 category gate.
**Acceptance criteria:**
- Matrix covers 100% of (subject x ceiling) pairs; every row asserts both surfaces.
- Legacy inputs included and pass via canonicalization.
- `bun test permission-matrix.test.ts` green.
**QA happy:** full matrix passes. Evidence: `t12-matrix-pass.txt` (test summary).
**QA failure:** intentionally flipping one expected cell makes the matrix fail (proves it's real).
Evidence: `t12-matrix-guard.txt`.
**Commit:** `test(mailbox): exhaustive permission-combination matrix`

### T13 - Live opencode-qa e2e with recorded evidence (the done-bar)
**WHERE:** QA only; evidence under `.omo/evidence/<YYYYMMDD>-project-message-iteration/`.
**WHAT:** In an isolated XDG sandbox (`opencode-qa` skill conventions), drive two real OpenCode sessions -
a sender project and a receiver project. Send a note via `project_message`, confirm it auto-drains on the
receiver's next idle (proving the C1 fix live), capture SSE proof the idle-drain hook fired, before/after
mailbox directory listings (processed/ populated), the outbox flipping to "read", and a TUI screenshot of
the two-column mailbox panel sitting above Magic Context. Also exercise: an over-ceiling send rejected,
and an offline target under `launch_policy:"ask"` prompting (mock allow) then delivering.
**References:** `.claude/skills/opencode-qa/` (scripts: sse-hook-probe, tui-smoke, isolation); AGENTS.md QA
section; T1-T11 behavior.
**Acceptance criteria:**
- Evidence dir contains: `summary.md` (what tested / observed / why enough / omitted), SSE hook-fired
  capture, before/after inbox+processed listings, outbox ack transition, TUI screenshot, isolation proof
  (session count unchanged in the real DB).
- The drain is observed LIVE (not a unit stub).
**QA happy:** valid note drains + acks live. Evidence: whole dir.
**QA failure:** over-ceiling note rejected live with reason; captured. Evidence: `e2e-reject.txt`.
**Commit:** `test(mailbox): live opencode-qa e2e evidence for cross-project drain`

### T14 - Update reference docs
**WHERE:** `docs/reference/cross-project-mailbox.md`, `docs/reference/hooks-and-tools.md`.
**WHAT:** Document the 3-tier model + category map, the advisory visibility/probe, presence + launch_policy
(with the default-disabled safety note), and the new TUI slot/layout. Keep it generic/reusable.
**References:** existing `docs/reference/cross-project-mailbox.md`, `hooks-and-tools.md` mailbox entries.
**Acceptance criteria:** docs describe every new config param and the launch permission flow; no stale
6-tier ladder references remain.
**QA happy:** grep shows 3-tier + launch_policy documented. Evidence: `t14-docs.txt`.
**QA failure:** no lingering `work-loop`/`review` tier references in the doc. Evidence: `t14-nostale.txt`.
**Commit:** `docs(mailbox): document 3-tier permissions, presence, launch policy, TUI`

## Final verification wave

Runs in parallel after ALL todos; ALL must APPROVE; surface results and wait for the user's explicit okay.
- **F1 plan-compliance audit** - every todo's acceptance criteria met; drain fix removes the dead cache;
  taxonomy synced across all 3 sites; launch default `disabled`; mailbox slot above 200.
- **F2 code-quality review** - no `as any`/`@ts-ignore`, no empty catch, no em-dashes; comment-checker +
  `prompt-async-route-audit` green; files under LOC ceiling.
- **F3 real manual QA** - re-run the T13 live e2e independently; confirm drain fires and TUI renders.
- **F4 scope-fidelity** - no out-of-scope changes (no interrupt/preemption work, no external-config
  rewrites, no Prometheus prompt edits, no model-config drift).

## Commit strategy

One commit per todo (messages above), on `feat/project-message-iteration` in the task-owned worktree.
QA-evidence commits reference their `.omo/evidence/<date>-project-message-iteration/` artifacts. Merge to
`dev` via a merge commit (`gh pr merge --merge --delete-branch`) only after the final verification wave
approves and the user gives explicit okay. Never squash/rebase-merge.

## Success criteria

1. Idle-drain fires in a live two-session e2e; receiver `processed/` populates and sender outbox flips to
   "read" (root cause fixed).
2. Permission model is 3-tier (question/impl/plan) with category gating; the full combination matrix
   passes on both preflight and inbound; legacy configs/notes migrate without hard-failing.
3. Sending agents can see advisory outbound authority + target presence before sending, and probe on demand.
4. `launch_policy` defaults to `disabled`; `ask` prompts via the injected permission surface; `auto`
   launches; all proven by unit + live QA.
5. project_message appears as a first-class flow in Sisyphus/Atlas/Hephaestus prompts, not Prometheus.
6. TUI mailbox renders as its own slot above Magic Context in a two-column label/count layout.
7. Schema regenerated + in-repo config migrated with the agent-harness `$schema`; external configs untouched.
8. Live evidence recorded under `.omo/evidence/`; all four final-verification reviewers approve.
