# Draft: mailbox-tui-sidebar-and-hot-reload

status: plan-written
pending-action: user choice - start work, or run dual high-accuracy review first
intent: CLEAR
plan: .omo/plans/mailbox-tui-sidebar-and-hot-reload.md (10 todos / 3 waves + F1-F4)
metis: done (findings folded: real fix = populate optional block default not just inner enabled;
  3-state outbound ack incl rejected/; idle+active render; viewKey hash outbound; merged-loader
  reload not single-file; last-known-good on partial JSONC; permissionless drain early-out;
  closure-in-tui(api) not in render fn; bounded outbox window; canonical projectId+repoRoot in outbox log)

## Request

P0: TUI sidebar status section for `project_message` inbox + outbox, showing UNRESOLVED
messages, modeled on AFT and magic-context sidebars, INCLUDING a click toggle to
expand/collapse the section.

P1: reload/modify project-message connections without reloading either OpenCode session.

## Resolved forks (user answers, §2058§)

- Q1 OUTBOX semantics → TWO states only: (1) sent, (2) read-by-dest. "Read" = the
  destination's idle-drain ACK (picked up by the idle session), NOT task completion.
- Q2 TOGGLE → "look at how magic-context does it" (repo: /Volumes/Topper2TB/Git/magic-context).
  Replicate MC's pattern: ▶/▼ triangle header, click row to toggle, persist collapse.
- Q3 RELOAD → option 1 (lazy re-read per operation). PLUS fix the enabled-flip problem by
  changing the schema DEFAULT `enabled` false→true so the tool+hook always register;
  user emulates "off" via no permissions (default_sender_access: allow-none + empty senders).
- TEST STRATEGY → TDD; project NOT done until a LIVE test is completed with evidence
  (drive the real opencode harness via opencode-qa skill; evidence under .omo/evidence/).

## Grounding — verified mechanisms (paths)

### Q1 ack mechanism (CONFIRMED)
- `MailboxStore.ack(messageId)` (mailbox/mailbox-store.ts:116) renames the note from the
  inbox (or `.delivering-<id>.md` reserved) to
  `<targetRepoRoot>/coordination_notes/<fromProjectId>/processed/<id>.md`.
- The idle-drain hook does NOT call ack() at dispatch — it `reserve()`s + `markDispatched()`s
  (idle-drain-hook.ts:119,136). ack() runs later via `reclaimStale`→`reclaimOne` once the
  injected message is confirmed in session history (state history_confirmed). So
  "read-by-dest" ≈ note has reached `processed/` in the TARGET repo.
- SENDER detects it: sender knows the target repoRoot via the registry. For each outbox
  entry (toProjectId, messageId), test existence of
  `<targetRepoRoot>/coordination_notes/<thisProjectId>/processed/<messageId>.md`.
  Exists → "read"; else → "sent" (unresolved). This is the new resolution C1 must add.
- CURRENT reader (`sidebar/mailbox-sidebar.ts`) only counts INBOUND unread/processed for
  THIS repo + a recentSent COUNT from the outbox log. It does NOT cross-reference target
  processed/ for outbound ack, and takes only (repoRoot, config) — no registry. C1 must
  inject the registry (listProjects → repoRoot map) and add outbound ack resolution.
- Outbox log: `send-tool/outbox-log.ts` appends JSON lines (OutboxEntry: sentAt,
  toProjectId, messageId, intent, correlationId, body). readRecentSent parses it.

### Q2 toggle pattern (CONFIRMED feasible; MC reference read in full)
- MC `sidebar-content.tsx`: slot-factory closure (plugin lifetime) holds a durable
  `SidebarController` (createSidebarController) owning prefs/collapsed/toggleCollapsed
  signals + a shared file watcher. Header box has
  `onMouseDown={() => controller.toggleCollapsed()}`, label `▶ `/`▼ ` triangle.
  Persists collapse via `queueTuiPreferenceUpdate(PLUGIN_KEY=["magic-context"],
  ["collapsed"], next)` to `~/.config/opencode/tui-preferences.jsonc` (comment-json,
  atomic temp+rename). => The host DOES forward mouse events into sidebar_content slot
  content. Click-toggle is real, no keybind fallback needed.
- Shared cross-plugin convention (tui-preferences.ts): anthropic-auth/AFT/MC all share
  ONE file `tui-preferences.jsonc`, one top-level key per plugin, byte-identical
  computeEffectiveOrder, default-order ladder (anthropic-auth 160, AFT 180, MC 200).
  omo can adopt the same file with key "oh-my-openagent" for collapse persistence.

### omo sidebar render model (DIFFERENT from MC — adapt, don't copy JSX)
- `tui.ts`: imperative `@opentui/solid` runtime. `materialize(buildViewNodes(currentView,
  theme), solid)` via solid.createElement/setProp/insert. Poll loop (POLL_INTERVAL_MS,
  constants.ts) → readView → viewKey diff → api.renderer.requestRender(). requestRender
  re-invokes renderSidebar (this is the ONLY update path today, so it's proven to re-run).
- `ViewNode` (element-helpers.ts) = { kind:"box"|"text", props:Record<string,unknown>,
  text?, children? }. props pass through setProp → an `onMouseDown` FUNCTION prop threads
  cleanly onto a box node.
- `buildViewNodes` (render-view.ts) is a PURE switch over view.kind (active/broken/idle).
  It has NO mailbox case today. `computeView`/`viewKey` (compute-view.ts) ALREADY thread
  `mailbox?` + hash `stableMailboxKey` (inboundUnread, inboundProcessed, recentSentCount)
  — but `readView()` in tui.ts NEVER populates sections.mailbox, so it's always absent.
- Collapse state is LOCAL UI state, NOT on disk → it must live in a tui.ts closure var
  (mirroring MC's controller), threaded into buildViewNodes as a param; the onMouseDown
  handler flips it + calls api.renderer.requestRender(). It is intentionally NOT part of
  viewKey (poll diff tracks data; toggle drives its own render).

### C4 config-freeze points (the stale surface for P1)
- Tool: `createMailboxToolsRecord` (tool-registry-mailbox-tools.ts) gates on
  `config?.enabled`, captures `config` + `createProjectRegistry()` ONCE. The tool's
  execute() closes over deps.config. Registry is re-read per call (listProjects), but
  config is frozen. Lazy re-read = execute() re-reads project config from disk each call.
- Hook: `createMailboxSessionHooks` captures config once → createMailboxHooks(ctx, config)
  → idle-drain deps.config frozen. Lazy re-read = the session.idle handler re-reads fresh
  config each drain.
- enabled is the ONE field not hot-reloadable via lazy re-read alone, because tool/hook
  REGISTRATION is session-start gated. Q3 fix removes the problem: default enabled=true so
  registration always happens; all real gating (senders/budget/bounds) is lazy-reloadable.

### auto-provision (auto-provision.ts) — must change
- Writes a stub `.opencode/oh-my-openagent.jsonc` with `enabled:false`,
  default_sender_access allow-none, empty senders. With the Q3 default flip this stub
  should write `enabled:true` (or omit enabled and rely on the new default) so a freshly
  provisioned project is on-but-permissionless ("emulated off"). NOTE (risk, out of
  scope): LOCAL_SCHEMA_PATH is a hardcoded agent-harness absolute path — portability smell.

## Topology lock (components)

- C1 — Sidebar state reader: inbound unresolved + outbound unresolved (sent vs ACKed via
  target processed/). Inject registry; add outbound-ack resolution.
- C2 — Render integration: populate sections.mailbox in readView; add a mailbox section to
  buildViewNodes (the orphaned-Todo-11 wiring, finished).
- C3 — Interactive expand/collapse toggle: ▶/▼ header, onMouseDown → flip closure flag +
  requestRender; persist collapse to tui-preferences.jsonc under key "oh-my-openagent".
- C4 — Config hot-reload (P1): lazy re-read project config per send + per drain; flip
  schema default enabled→true; auto-provision writes enabled:true; document that "off" =
  allow-none + empty senders.

## Defaults adopted (not asked — evidence-backed)

- Collapse persistence file: shared `~/.config/opencode/tui-preferences.jsonc`, key
  "oh-my-openagent" (matches the established cross-plugin convention MC/AFT use).
- Sidebar shows only when there's signal: if enabled but inbound+outbound unresolved all
  zero, render a single muted "Mailbox idle" line (collapsed-equivalent) rather than a big
  empty box — avoids noise now that enabled defaults true everywhere.
- Sidebar slot stays in the existing omo registration (order 900); mailbox is a SECTION
  within omo's sidebar, not a separate slot.

## Approval gate

REACHED. Brief presented to user; awaiting explicit approval to write the plan file.
On resume after compaction: read this draft, resume at the gate, do NOT re-explore.
