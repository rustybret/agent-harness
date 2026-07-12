---
slug: mailbox-sidebar-aft
status: plan-written
intent: clear
review_required: false
pending-action: write .omo/plans/mailbox-sidebar-aft.md
approach: Port the cross-project mailbox sidebar slot to AFT's Solid-TSX architecture (precompiled via transformSolidSource + opentui virtual runtime-module ids), fixing the bundled-second-solid-js reactivity bug at the root; adopt AFT's form/function/styling (accent badge header toggle, StatRow/SectionHeader, collapsed digest, AFT-shaped tui-preferences schema); OMO status slot stays on the materialize pipeline but inherits host-runtime-bound signals.
---

# Draft: mailbox-sidebar-aft

## Components (topology ledger)
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
- C1 | Build pipeline: Solid TSX precompile step + host-runtime binding for dist/tui.js | active | script/build.ts:53-62, dist/tui.js:92458
- C2 | Mailbox JSX panel (AFT form/function/styling) replacing materialize-rendered mailbox slot | active | aft docs + sidebar.tsx
- C3 | Prefs schema extension (AFT-shaped) + watcher under key "oh-my-openagent" | active | packages/omo-opencode/src/features/tui-sidebar/tui-preferences.ts
- C4 | Attribution (CortexKit MIT: AFT + magic-context) | active | THIRD-PARTY-NOTICES.md
- C5 | Live QA via macos-cua real clicks + regression of /project-mailbox dialog | active | .omo/evidence/
- C6 | Dirty-worktree hygiene: uncommitted bug-2a onSelect unwrap fix in tui-command.ts (+tests) | active | packages/omo-opencode/src/features/cross-project-mailbox/dialog/tui-command.ts:74-118

## Open assumptions (announced defaults)
<!-- assumption | adopted default | rationale | reversible? -->
- Header shows plugin version right-aligned | default true, pref-gated (header.showVersion) | matches AFT form | yes
- Mailbox panel gets its own single-border box (AFT root container form) | adopt | "form and styling of AFT" | yes
- Fallback when host lacks opentui:runtime-module registry | keep existing materialize mailbox renderer as graceful degradation | zero-risk on older hosts | yes
- New TSX tree location | packages/omo-opencode/src/tui-solid/ (dir sibling to tui.ts; transformed to dist/tui-compiled/) | avoids name clash with src/tui.ts; clean transform boundary like AFT src/tui -> src/tui-compiled | yes
- Poll/refresh loop | keep existing 1s disk poll + viewKey dedupe in tui.ts; NO RPC/WS transport | our state is same-machine disk files; AFT doc SS5 solves a cross-process problem we do not have | yes

## Findings (cited - path:lines)
- ROOT CAUSE Bug 1: script/build.ts:53 externalizes only @opentui/core|keymap|solid; solid-js is bundled INTO dist/tui.js (dist/tui.js:92458 shows `await import("solid-js")` compiled to `(init_server2(), exports_server)` - a second, private solid-js SERVER build). Signals created on it are invisible to the host's children() memo (opencode/packages/tui/src/plugin/slots.tsx createSolidSlotRegistry), so collapse clicks flip state but never repaint. Matches project memory #1668.
- Host runtime: opencode fork pins @opentui/* 0.4.3 (opencode/package.json:43-45 catalog). AFT (working under cmux in the same live session) pins the same 0.4.3 + solid-js 1.9.12 (aft/packages/opencode-plugin/package.json:38-41) and binds the host runtime via `opentui:runtime-module:<specifier>` virtual ids (aft .../src/tui/entry.mjs, scripts/build-tui.ts).
- Our installed @opentui/solid devDep is 0.2.16 and does NOT ship scripts/solid-transform.js (verified: no scripts/ dir in node_modules/.bun/@opentui+solid@0.2.16*). Precompile requires bump to 0.4.3.
- Ambient types: packages/omo-opencode/src/types/opentui-solid.d.ts declares module "@opentui/solid" - must be reconciled with real 0.4.3 types after bump.
- AFT reference implementation: aft/packages/opencode-plugin/src/tui/sidebar.tsx (createAftSidebarSlot:842; header toggle onMouseDown 579-619; StatRow/SectionHeader/tone patterns), preferences.ts (AftTuiPrefs schema, computeEffectiveOrder, watchTuiPreferences, persistCollapsedIfEnabled), badge-contrast.ts, entry.mjs, scripts/build-tui.ts, docs/building-a-tui-sidebar-plugin.md.
- Magic-context reference: magic-context/packages/plugin/src/tui/slots/sidebar-content.tsx - createSidebarController in slot-factory closure (45-88) so collapse survives sidebar_content remounts; header row onMouseDown 691-703; watcher echo guard.
- Ours today: packages/omo-opencode/src/tui.ts (createSignalPair, materialize, registerSidebarContentSlot MAILBOX_SLOT_ORDER=150 / OMO_SLOT_ORDER=900, 1s poll POLL_INTERVAL_MS); features/tui-sidebar/render-view.ts mailboxNodes:285-338 (header toggle row 292-294); tui-preferences.ts (key "oh-my-openagent", jsonc-parser surgical writes, only mailbox.collapsed).
- Packaging: root package.json exports "./tui": "./dist/tui.js" (line 102), files ships dist/ wholesale (line 44+). Host loads dist/tui.js sibling of the configured file:///.../dist/index.js plugin path, NOT via entry.mjs - so runtime selection must live inside the bundled dist/tui.js, importing dist/tui-compiled/* via new URL(..., import.meta.url).
- QA methodology finding: raw SGR escapes written to /dev/ttys* are OUTPUT to the display, not input to opencode - clicking AFT's own known-working toggle that way also "failed" (control test). Never use it as evidence. macos-cua CLI works (node ~/Git/macos-cua/packages/cli/dist/cli.js) but the test screenshot showed wallpaper-only = Screen Recording permission not granted to the invoking terminal binary; the MCP server failed to connect. QA todo needs a permission preflight; fallback = tmux send-keys -H <hex SGR bytes> into a tmux-hosted opencode pane (reaches the app's stdin).
- Dirty worktree: bug-2a fix (DialogSelect onSelect receives TuiDialogSelectOption wrapper; code must unwrap .value - opencode/packages/tui/src/plugin/adapters.tsx:82-96) is implemented + live-verified (real disk write of intent_budget plan->impl->plan) but likely UNCOMMITTED in the main tree (tui-command.ts + tui-command.test.ts). Must land first.

## Decisions (with rationale)
- 1a Mailbox slot only: OMO status slot (loop/agents/jobs) keeps ViewNode materialize pipeline; both slots' signals become host-runtime-bound so BOTH become properly reactive.
- 2a Full AFT pattern: src TSX -> transformSolidSource precompile -> virtual runtime-module ids; devDep bump @opentui/* 0.2.16 -> 0.4.3; solid-js added to tui bundle externals; runtime selection inside dist/tui.js (virtual registry probe -> compiled JSX slot; else legacy materialize fallback).
- 3 Direct adoption of AFT MIT code (badge-contrast.ts, preferences patterns, sidebar skeleton, build-tui.ts transform script) with per-file attribution headers + THIRD-PARTY-NOTICES.md entries for AFT and magic-context (CortexKit, MIT). User: "we love Cortexkit. much attribution and love."
- 4a Tests-after per todo (bun test, given/when/then) + mandatory live QA evidence; QA clicks via macos-cua real OS clicks (user preference), tmux hex-byte injection as fallback.
- Execution: sequential todo execution in the MAIN worktree (user advised against worktrees; memory #1950 forbids parallel git ops in one tree). Direct commits to fork/local (memory #1789 - no PR workflow for fork maintenance).

## Scope IN
- Mailbox sidebar panel rewrite as Solid TSX (AFT form/function/styling); collapse toggle fix; prefs schema extension + watcher; build precompile step; host-runtime signal binding for both slots; attribution; live QA; landing the uncommitted bug-2a fix.

## Scope OUT (Must NOT have)
- NO RPC server / WebSocket / port files / notification fan-out (AFT doc SS5, SS8 server-push) - our data is local disk, poll stays.
- NO JSX port of the OMO status slot (order 900) - materialize pipeline stays for it.
- NO change to mailbox data semantics (counts, presence derivation, registry IO).
- NO cmux mouse-protocol investigation or workarounds - root cause is the bundled runtime, and AFT proves clicks arrive.
- NO raw /dev/ttys* escape writes as QA evidence.
- NO upstream PR; no packages/web; no version bumps in package.json beyond @opentui devDeps.
- NO removal of the legacy materialize mailbox renderer (it is the older-host fallback).

## Open questions
(none - all forks answered: 1a, 2a, 3 yes, 4a + macos-cua)

## Approval gate
status: approved (user message 2648: "1a, 2a, 3 yes! ... 4. a, prefer using macos-cua real clicks")
pending-action: DONE - .omo/plans/mailbox-sidebar-aft.md written with 10 todos + F1-F4.
review: momus + oracle dual review NOT yet requested; offered after plan delivery (awaiting user pick: start work vs high-accuracy review).

## Metis receipt
- session: ses_0ab902f71ffeJI2eO3xCDE6JgT (bg_f244b506), completed 6m20s.
- Folded in: deps are PROD not devDeps (T2); real-runtime smoke vs mocked tui.test (T2); shared runtime loader for both slots (T6); dynamic-specifier probe so bun can't inline (T6); build node + scoped jsx tsconfig (T3); prefs back-compat collapsed ?? mailbox.collapsed + order/forceToTop restart-required (T4); mailbox-specific section names (T4/T7); pack-install smoke + tarball assert (T9); notices checker gate scripts/check-third-party-notices.mjs --ship (T5); comment-checker-safe attribution headers (T5); semantic regression suite (T7); opencode-qa isolation + evidence (T10); commit strategy made explicit incl. models*.json exclusion + push gated on user okay.
- Rejected as stale: Metis claimed the DialogSelect .value unwrap fix is absent from tui-command.ts; grep of the working tree shows `selected.value`/`selectedSubOpt.value` present (lines 74-118) and wrapper-shaped tests - T1 still instructs the executor to verify by reading, trusting neither claim.
- Noted contradiction resolved: repo-wide "never commit unless requested" vs fork policy - user's standing fork rule (memory #1789: direct commits to fork/local) + explicit per-todo commits in this approved plan constitute the request; push still gated on explicit user okay (Commit strategy section).
