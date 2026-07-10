You are an adversarial, high-accuracy plan reviewer. Verify a WORK PLAN against the REAL codebase. Do NOT write code or modify anything. This is read-only.

## Files to review (read them in full)
- Plan: `.omo/plans/mailbox-tui-sidebar-and-hot-reload.md`
- Design draft (verified mechanisms + cited paths): `.omo/drafts/mailbox-tui-sidebar-and-hot-reload.md`

## What the plan does (4 components, 10 todos)
This is the oh-my-openagent OpenCode plugin fork. The plan finishes a partially-wired cross-project mailbox TUI sidebar + adds config hot-reload:
- C1/T5: extend `packages/omo-opencode/src/features/cross-project-mailbox/sidebar/mailbox-sidebar.ts` to resolve 3-state OUTBOUND ack (target repo `processed/` = read, `rejected/` = failed, neither = sent) over a bounded outbox window, injecting the project registry.
- C2/T8-T9: populate `sections.mailbox` in `packages/omo-opencode/src/tui.ts` `readView()` (never set today), thread mailbox into BOTH active+idle views in `features/tui-sidebar/compute-view.ts`, extend `viewKey`/`stableMailboxKey` to hash outbound fields, render a mailbox section in `features/tui-sidebar/render-view.ts` `buildViewNodes()`.
- C3/T10: a ▶/▼ click-toggle (opentui `onMouseDown` function prop on the header box) that flips a closure flag in `tui(api)` scope + `api.renderer.requestRender()`, persisted to shared `~/.config/opencode/tui-preferences.jsonc` under top-level key `"oh-my-openagent"` via a new helper (T3).
- C4/T6-T7: lazy per-operation config re-read (send + idle-drain) using the EXISTING merged loader, last-known-good on partial JSONC; flip schema default so the whole `cross_project_mailbox` block defaults populated with `enabled:true` (T1) so tool+hook always register; "off" = `default_sender_access:"allow-none"` + empty `senders`; permissionless idle-drain early-out; auto-provision stub writes enabled:true (T4); outbox log records canonical projectId + repoRoot (T2).

## Your job — VERIFY against the actual source, then return a verdict
Check each claim against real files. Specifically interrogate:
1. **Schema default (T1):** does the plan's approach (`CrossProjectMailboxConfigSchema.default(() => CrossProjectMailboxConfigSchema.parse({}))` on the ROOT field in `packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts`) actually produce a populated block when omitted? Are the gating consumers (`plugin/tool-registry-mailbox-tools.ts`, `plugin/hooks/create-mailbox-session-hooks.ts`) correctly identified? Did the plan find EVERY test asserting the old `enabled:false` default (search yourself)? Any blast radius the plan misses (prompt-async gate, other plugins, auto-provision in unrelated repos, generated schema asset)?
2. **Outbound ack (T5):** are the target dirs `processed/`/`rejected/` correct per `features/cross-project-mailbox/mailbox/mailbox-store.ts`? The drain ack()s LATER (reclaimStale/history_confirmed), not at dispatch — does the plan's "sent until processed" semantics hold? Is `projectIdForRoot`/the registry resolution real and correctly named? Is the bounded-window claim coherent with the current `readRecentSent` limit?
3. **Lazy reload (T6/T7):** does the "existing merged loader" the plan names actually exist and is it callable per-directory the way T6/T8 claim (`loadPluginValidation`/`validatePluginConfig` in `tui.ts`/`config/validate.ts`)? Is the static tool `inputSchema` `max_body_bytes` freeze correctly flagged? Is the permissionless early-out logic (`default_sender_access==="allow-none"` AND no `senders` allow) correct against the real config shape?
4. **Render/toggle (T8-T10):** is the omo sidebar render model (imperative `materialize(buildViewNodes())`, `ViewNode.props`→`setProp`, requestRender re-invokes renderSidebar) accurate? Is placing the collapse flag in `tui(api)` closure (not inside renderSidebar) correct given remount behavior? Does `compute-view.ts` really only carry mailbox in the active view today? Does `viewKey` really hash only counts today?
5. **Contradictions / ordering / missing acceptance criteria / dependency-matrix errors** across the 10 todos.

## Output format (MANDATORY)
Start with one line: `VERDICT: APPROVE` or `VERDICT: REJECT`.
Then `## Blockers` (must-fix, each with a file:line citation proving it), then `## Non-blocking notes`. Be specific and terse. If you cannot verify a claim from the source, say so explicitly rather than assuming.
