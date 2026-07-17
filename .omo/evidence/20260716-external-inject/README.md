# External-Event → Active-Session Inject Bridge — QA Evidence

**Date:** 2026-07-16
**Feature:** `packages/omo-opencode/src/features/external-inject/` + config schema + plugin-init mount
**Plan:** `.omo/plans/external-event-session-inject.md`
**Requested by:** unitySuperMCP (cross-project mailbox note `39c8f0d2`)

## What was tested

The external-inject bridge: a plugin-hosted loopback HTTP listener that accepts a
`POST /rpc/inject` from an external MCP server (unitySuperMCP) and routes the text
through the sanctioned `dispatchInternalPrompt` gate so it lands as a
`<system-reminder>` in a live opencode session. Off by default, loopback-only,
token-authed, fail-closed.

Driven against a **real `opencode serve`** in an isolated XDG sandbox — not a mock.

## What was observed

### Live HTTP contract (driver: `external-inject-live-qa.sh`) — 9/9 PASS

| Assertion | Result |
| --- | --- |
| Port file discovered under `<xdg>/oh-my-opencode/external-inject/rpc/<projectHash>/ports/` | PASS |
| Port file perms `0600` | PASS |
| `GET /health` → 200 `{ok:true,pid}` | PASS |
| `POST /rpc/describe` → 200 with capability metadata | PASS |
| describe reports configured `max_text_bytes=64` | PASS |
| describe reports configured `rate_limit.max=3` | PASS |
| inject with bad token → 403 | PASS |
| inject oversize text (> max_text_bytes) → 413 | PASS |
| inject with no active session → 409 `no-active-session` | PASS |
| inject explicit live session → 202 `accepted` | PASS |

Key discovery during QA: the plugin `server()` hook (which starts the bridge)
fires **lazily on first project bootstrap** (`GET /agent?directory=<dir>`), not on
`Server.listen`. The driver triggers bootstrap before polling for the port file.

### Message actually LANDS (driver: `external-inject-landing-verify.sh`)

The decisive end-to-end proof (202 "accepted" alone only proves the gate accepted
the dispatch). A unique marker `UNITY_COMPILE_ERROR_MARKER_<pid>` was injected via
`POST /rpc/inject` targeting a real session, then read back:

```
inject_code=202 body={"status":"accepted"}
LANDED: injected marker found in session messages
```

Captured session messages: `live-qa/session-messages.json`.

### Isolation proof

Real DB session count **6195 before → 6195 after** (unchanged). All QA ran under an
isolated `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` +
private `TMPDIR`; the host `~/.local/share/opencode/opencode.db` and
`~/.config/opencode` were never touched. Sandbox temp dirs cleaned up post-run; no
leftover QA processes.

## Unit coverage (TDD floor, RED→GREEN per task)

- T0 config schema — 10 pass
- T1 loopback listener (port-file + transport + handler) — 18 pass
- T2 session-addressing resolver — 6 pass
- T3 injection adapter (routes through the gate; #584 prompt-async route audit passes) — 8 pass
- T4 rate limiter + coalescer — 6 pass
- T5 session tracker + plugin-init mount seam — 8 pass
- Full feature suite: 63 pass, 0 fail. Workspace typecheck clean. `#584` route audit: 10 pass.

## Why this is enough

The real user-visible outcome (external event → text appears in a live session) is
proven by driving the real harness end-to-end and reading the marker back from the
session, plus the full HTTP error/auth/limit contract and isolation proof. The
sanctioned `dispatchInternalPrompt` gate is the single injection route (no raw
`promptAsync`), enforced by the #584 static audit.

## What was omitted / residual risk

- No real LLM was involved (models fetch disabled); the injection lands as a session
  message, which is the harness-side contract. unitySuperMCP owns the true e2e
  (real Unity event → their Elixir watcher → POST → injection), per the agreed
  ownership split.
- Delivery is `defer` (lands at next idle/safe point), not mid-turn preemption —
  by design; documented in the integration spec sent to unitySuperMCP.
