# agent-harness tooling improvement roadmap

Standing backlog of tooling defects and gaps in this fork, sourced from **observed behavior in real
cross-project agent sessions** rather than speculation. Every item cites where the evidence came from.

Working mode: pick the top unblocked item, implement it, verify it, mark it done, then re-prioritize
the remainder and pick again. Items are only added here when a real session produced evidence for them.

## Priority legend

- **P0** — correctness bug with observed wrong output in a live session
- **P1** — trust/usability gap that real coordination hit repeatedly
- **P2** — feature gap with a workable stand-in today
- **P3** — speculative / nice-to-have; needs a concrete ask before building

---

## P0 — correctness bugs

### 1. Sidebar `isNoteFile()` counts stale/unparseable `.md` as unread — DONE

- **Source:** cloudhome note `25406036-7240-4c77-809b-606470c1c6bd`, reprioritized up in
  `621af36b-7ef7-4436-8ead-7f7c752ecc84` ("a legacy doc masquerading as unread pollutes our actual
  todo signal").
- **Observed:** TUI sidebar `inboundUnread` counted hand-authored legacy markdown docs sitting in
  `coordination_notes/<sender>/` that the real store never delivers.
- **Root cause:** `sidebar/mailbox-sidebar.ts` `isNoteFile()` matched on `.md` suffix alone, while the
  delivery path (`mailbox/mailbox-store.ts` `listUnread()`) parses the envelope and skips files that
  fail. Two different definitions of "a note".
- **Fix:** validate the YAML envelope head in the sidebar count so the two paths agree.

### 2. Migrated `agents.*.models` silently dropped at runtime — DONE

- **Source:** found while QA'ing item 1 — `readView` on a clean fixture returned `kind: "broken"` with
  eleven `Unknown config key: agents.<name>.models` messages sourced from this machine's own
  `~/.omo/omo.jsonc`.
- **Observed:** all 11 configured agents resolved `model: null` with zero fallbacks. The user's entire
  model selection (77 fallback entries) was inert while the config file looked correct on disk.
- **Root cause:** the 2026-08 reasoning-unification migration rewrites an agent's
  `model`+`variant`+`fallback_models` into a canonical `models` array, but `AgentOverrideConfigSchema`
  never had a `models` field — and being non-strict, it dropped the key instead of rejecting it. The
  migration emitted config its own validator could not read.
- **Second defect found in the fix:** `findUnknownKeyPaths` unwrapped a `pipe` through its `in` side,
  but `z.preprocess` compiles to a pipe whose `in` is the transform (no shape) — so every nested key
  under a preprocessed schema was silently un-diagnosed. This already affected `categories.*`.
- **Fix:** unpack the canonical chain into `model` + `fallback_models` before validation; traverse
  preprocessed schemas through their output object.

---

## P1 — trust gaps

### 3. No sender-side delivery-failure feedback — DONE

- **Source:** cloudhome `25406036-…`, explicitly bumped to top in `621af36b-…` ("the one that
  actually erodes trust in the channel — we've had real 'did this ever land' uncertainty with ORW
  exchanges").
- **Observed:** a hard reject (unallowlisted sender, intent above ceiling) is silent on the sender
  side. The sender sees a successful `project_message` call and never learns the note was dropped.
- **Asked-for minimum (their words):** (a) sender-side receipt when a hard reject happens, (b) a way
  to ask "still undelivered after N hours".
- **Existing material:** the sidebar already computes `outboundUnresolved` / `outboundRead` /
  `outboundFailed` from `coordination_notes/<sender>/{processed,rejected}/` markers, and
  `.omo/mailbox-outbox.jsonl` already records every send with `sentAt`. An age-based
  "unresolved for > N hours" read is mostly assembly, not new plumbing.
- **Answered:** every hard reject goes through `MailboxStore.quarantine()`, which moves the note to
  `rejected/<id>.md` AND writes `<id>.reason.json` with the reason and detail. The artifact always
  exists — it was just never readable from the sender side. Rate-limiting is the one exception: it
  unreserves rather than quarantining, so it stays visible as `pending`/`stale` rather than as a
  rejection, which is the honest reading since the note is still deliverable.
- **Fix:** `project_message mode=status` reads the sender's outbox log, resolves each entry against
  the target's acknowledgement dirs, and reports processed / rejected (with the receiver's reason) /
  pending / stale (`staleAfterHours`, default 4) / unresolved-target. Read-only.

### 4. Auto-drain silently no-ops when primary agent is not intake-eligible — DONE

- **Source:** cloudhome `25406036-…` (explains their "manual drain finds notes auto-drain skipped").
- **Observed:** `shouldSkipDrain()` returns without draining and without any log/user-visible signal
  when the session's primary agent is absent from `intake_eligible_agents`.
- **Impact:** looks identical to "no mail" from the receiving side, so nobody investigates.

---

## P2 — feature gaps with stand-ins

### 5. Cross-batch supersession

- **Source:** art3d-pipeline `3cf4fe37-650a-4c9d-839e-3eb6032f20c6`, and cloudhome independently.
- **Observed:** `supersedes` only dedupes within a single drain batch. A correction sent after the
  original already drained does not invalidate the work in flight.
- **Stand-in:** `requested_mode: "interrupt"` queue-jumps and nudges a drain, which covers the urgent
  case but does not mark the superseded note as invalid.

### 6. Per-message tier escalation

- **Source:** cloudhome `25406036-…`.
- **Observed:** intent ceiling is fixed per sender in config; a sender cannot request a one-off
  escalation for a single message.
- **Stand-in:** ask the receiving project to raise the grant, which is a config edit + restart.

### 7. Structured `deliverable` field / notify-on-drain callback

- **Source:** cloudhome `25406036-…`, art3d-pipeline `3cf4fe37-…`.
- **Status:** cloudhome explicitly said in `621af36b-…` these are **fine staying unscheduled** —
  `category` + prose body is a workable stand-in.

---

## P3 — needs an explicit ask before building

### 8. Restricted low-budget subagent tier (Gemma-class models)

- **Source:** opencode-gemini `e2b93506-51f7-4d62-b39c-1d247da26980`.
- **Ask:** a subagent category that fits a ~16k input-tokens/min free-tier budget.
- **Finding:** existing `CategoryConfig` fields get partway (`max_tokens`, `max_prompt_tokens`,
  `tools`) but fall short — `max_prompt_tokens` only trims skill/agents-context content, not the base
  sisyphus-junior system prompt or the always-on tool schemas, and there is no `max_turns` field at
  all. The existing `FREE_OR_LOCAL_PROMPT_TOKEN_LIMIT` (24k) is already ~8x over their budget.
- **Blocked on:** an explicit build request plus scoping. Not building speculatively.

---

## Done

- **P0-1** sidebar `isNoteFile()` stale-doc counting — envelope-validated count now matches the
  delivery path's definition of a note.
- **P0-2** migrated `agents.*.models` silently dropped — canonical chain now unpacked before
  validation; preprocessed schemas no longer blind the unknown-key diagnostics.
- **P1-3** sender-side delivery-failure feedback — `project_message mode=status` surfaces the
  receiver's rejection reason and ages unacknowledged sends into `stale`.
- **P1-4** silent drain gate — shared `drain-gate` evaluator; a blocked idle drain now emits a
  `drain-skipped` trace with a `waiting` count, and `project_mailbox_peek` reports `autoDrain`.
