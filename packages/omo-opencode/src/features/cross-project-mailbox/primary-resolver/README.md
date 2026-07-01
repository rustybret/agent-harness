# primary-resolver

Active-primary agent resolver for the cross-project mailbox.

## What it does

`resolveActivePrimaryAgent(sessionId)` reads the live per-session agent from the
`sessionAgentMap` store in `claude-code-session-state/state.ts` (written by
`updateSessionAgent()` on the `chat.message` path). It resolves display names and
legacy parenthesized names to their registered alias via `resolveRegisteredAgentName`,
then canonicalizes to the lowercase config key via `getAgentConfigKey` so the result
can be compared directly against `intake_eligible_agents` (which are config keys).

```ts
import { resolveActivePrimaryAgent } from "./primary-resolver"

// in the drain hook:
const primary = resolveActivePrimaryAgent(sessionId) // string | undefined, e.g. "sisyphus"
```

A session with no recorded agent resolves to `undefined`, which the drain hook
treats as ineligible (fail-closed). The resolver is synchronous by design - it is
on a hot path and a `Map.get` plus canonicalization is all it needs.

## Accuracy guarantee

The returned config key reflects the most recent agent recorded for that session
by the `chat.message` path. If the user switches agents via Tab AFTER the last
message but BEFORE the next idle, the store may return the previous agent until the
next chat event re-records the new one.
