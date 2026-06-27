# primary-resolver

Last-known active-primary agent resolver for the cross-project mailbox.

## What it does

`AgentPrimaryCache` keeps a per-process, per-session map of `sessionId -> agentName`.
The cache is fed from the `chat.message` / `chat.params` hook input's `agent` field
(both hooks carry `agent` at the same level as `sessionID`). The idle-drain hook
(todo 8) calls `resolveActivePrimaryAgent(sessionId)` and checks the result against
`intake_eligible_agents`.

```ts
import { agentPrimaryCache, resolveActivePrimaryAgent } from "./primary-resolver"

// in the chat.message / chat.params handler:
if (input.agent) agentPrimaryCache.observe(input.sessionID, input.agent)

// in the drain hook:
const primary = resolveActivePrimaryAgent(sessionId) // string | undefined
```

A session that was never observed resolves to `undefined`, which the drain hook
treats as ineligible (fail-closed). The resolver is synchronous by design — it is
on a hot path and a `Map.get` is all it needs.

## Accuracy guarantee

**v1 accuracy: last-known.** The returned agent name is the one cached from the
most recent `chat.message` / `chat.params` event for that session. If the user
switches agents via Tab AFTER the last message but BEFORE the next idle, the cache
may return the previous agent until the next chat event re-observes the new one.

**Measured accuracy (opencode-qa probe, 2026-06-27, opencode local fork build
`0.0.0-fork/local-202606200542`, isolated XDG sandbox):**

- The probe drove `opencode run --format json` in an isolated XDG sandbox.
- Isolation held: sandbox `session` count went 0 -> 1 (only the sandbox's own
  session); the host DB at `~/.local/share/opencode/opencode.db` was never written
  (4806 sessions, mtime unchanged, predating the probe).
- Every streamed JSON event carried `sessionID` at the top level of the event
  envelope, confirming the session key the cache needs is present on the chat
  surface. The `agent` field rides alongside `sessionID` in the `chat.message` /
  `chat.params` hook inputs (see `plugin-interface.ts` `chat.params` handler and
  `plugin/chat-message.ts`, which already reads `input.agent`).
- The sandbox has no provider auth, so the model call itself errored
  (`Model not found: anthropic/claude-opus-4-7`) before producing assistant text.
  That does not affect this resolver: the `agent` field is set by opencode on the
  hook input regardless of whether the model call succeeds, and the existing
  `chat-message.ts` `updateSessionAgent(input.sessionID, input.agent)` path already
  depends on it.
- Tab-switch timing was NOT directly instrumented in the probe (a non-interactive
  `opencode run` invocation does not switch agents mid-session). The last-known
  window described above is therefore a design property, not a number measured by
  this probe. Real-time Tab-switch observability is the v2 question below.

**Decision (plan-fixed):** v1 ships on last-known regardless of the probe outcome.
The probe documents measured accuracy; it is not a behavioral gate.

## Precision path for v2

If Tab switches become observable in real time (an agent-change event that fires
before the next chat event), the cache can be updated from that event so the
window shrinks to zero. There is no opencode SDK API to switch the active primary
programmatically (no `client.session.setAgent`), so v1 cannot proactively pin the
agent — it can only observe. Real-time agent-change observation is NOT implemented
in v1.
