# Codex round-3 review verdict (gpt-5.5 xhigh, isolated read-only)

VERDICT: REJECT-WITH-FIXES (1 blocker)

ITEM 1 (rate-limit contradiction): RESOLVED
ITEM 2 (receiver-policy shape): RESOLVED
ITEM 3 (hop/correlation derivation): NOT-RESOLVED  <-- blocker
ITEM 4 (ack-state): RESOLVED
ITEM 5 (todo 14 isolation wording): RESOLVED
ITEM 6 (todo 10/11 wave parallelism): RESOLVED

BLOCKER 1 — Todo 9 line 169 + Todo 2 line 102:
  - Todo 9 input schema lists `correlationId?: string|null` BUT also says
    "the agent can NEVER supply hopCount/hopPath/correlationId directly" -> contradiction.
  - Todo 2 `MailboxMessageSchema` omits `correlationId` while Todo 9 reads `parent.correlationId`.
  Required change:
    (a) remove `correlationId` from the tool input (todo 9),
    (b) add `correlationId` explicitly to todo 2 envelope/schema AND the Scope wire-format list,
    (c) fresh sends always generate a new UUID,
    (d) replies carry parent.correlationId,
    (e) state whether `inReplyToMessageId` is input-only or persisted in the envelope.

Isolation: real ~/.codex/auth.json shasum unchanged; config.toml mtime unchanged; ephemeral CODEX_HOME removed.
