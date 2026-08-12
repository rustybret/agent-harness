# Plan: Cross-Batch Supersession & Mailbox Protocol Versioning

## Overview
This plan addresses P2 Item 5 (Cross-batch Supersession) and Item 5.5 (Message Protocol Versioning) in the cross-project agent mailbox feature set.

- **Item 5 (Cross-Batch Supersession)**: Currently, when Note B supersedes Note A, `drainUnread` only filters Note A out if Note A and Note B are in the same unread batch. If Note A was delivered in a prior batch, Note A remains in `processed/` unflagged. If Note A is in `inbox`, it remains orphaned. We will extend `MailboxStore` and delivery pipeline logic to cleanly mark/quarantine superseded notes across batches in both `inbox` and `processed/`.
- **Item 5.5 (Message Protocol Versioning)**: Upgrade the mailbox envelope schema and presence heartbeat records to support protocol versioning (`version: 2`). Schema validation must be backwards-compatible with `version: 1` and forwards-compatible with higher protocol versions without mistaking version deltas for envelope corruption. Presence handshakes will broadcast `protocolVersion: 2`.

---

## Proposed Architecture & Options

### Workstream 1: Cross-Batch Supersession (Item 5)

#### Option A: Immediate Supersession Invalidation on Drain & Ingress (Recommended)
- **`MailboxStore.markSuperseded(supersededId: string)`**:
  - Checks if `supersededId` exists in `inbox` (unread). If found, moves it to `rejected/` with reason `superseded` (or `quarantine(supersededId, "superseded", ...)`).
  - Checks if `supersededId` exists in `processed/`. If found, moves it to `processed/superseded/` (or writes `${supersededId}.superseded.json` in `processed/`), marking the note as superseded while preserving full auditability.
- **Integration in `drainUnread`**:
  - When Note B (which has `supersedes: Note A`) is drained/acked, `MailboxStore` automatically invokes `markSuperseded(Note A)`.
  - If Note A was in `processed/`, `wasDelivered(Note A)` still evaluates `true` prior to or during the check so Note B retains `supersedesDelivered: true`, ensuring the active session receives the `CORRECTION:` injection notice.
  - If Note A was sitting unread in `inbox`, `markSuperseded(Note A)` archives/quarantines Note A immediately so it never gets processed later.

#### Option B: Deferred Supersession Flagging
- Only write a JSON marker on drain without moving files.
- *Tradeoff*: Keeps files in-place but increases query complexity when inspecting `inbox` or `processed/`.

*Recommendation*: **Option A** — Clean, explicit file-state movement (`processed/superseded/` and `rejected/` quarantine) preventing stale notes from ever re-draining or misinforming UI/sidebar inspectors.

---

### Workstream 2: Message Protocol Versioning & Backwards Compatibility (Item 5.5)

#### Protocol Version Contract:
- **`CURRENT_PROTOCOL_VERSION = 2`**.
- Envelope serialization defaults `version` to `2`.
- Envelope parsing (`MailboxMessageSchema` & `LenientMailboxMessageSchema`):
  - Change `version: z.literal(1)` to `z.number().int().positive().default(CURRENT_PROTOCOL_VERSION)`.
  - Tolerates `version: 1` (legacy), `version: 2` (current), and `version > 2` (future versions).
  - Envelope parsing strips unknown future fields safely via `LenientMailboxMessageSchema.strip()`.
  - Messages with `version > CURRENT_PROTOCOL_VERSION` flag `isFutureProtocolVersion: true` on the parsed object without throwing errors, ensuring smooth interoperability across heterogeneous agent versions.

#### Presence Handshake Protocol Versioning:
- Update `PresenceRecord` schema to include `protocolVersion?: number` (defaults to `1` if omitted from disk).
- `writePresenceRecord` sets `protocolVersion: CURRENT_PROTOCOL_VERSION` (2).
- `readPresenceDetail` and `readPresenceStatus` preserve and return `protocolVersion` in presence details.
- Presence handshake broadcasts protocol version so peer projects can verify compatibility before sending version-specific features.

---

## Tasks & Checklist

## Todos

- [x] 1. Envelope Schema Update (`packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema.ts`): Update schema `version` to `z.number().int().positive().default(2)`, define `CURRENT_PROTOCOL_VERSION = 2`, and update envelope parsing/serialization tests.
  - **QA Scenario**: Run `bun test packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema.test.ts`. Expect legacy `version: 1`, current `version: 2`, and future `version: 3` envelopes with unknown fields to parse without throwing validation errors.
- [x] 2. Presence Protocol Versioning (`packages/omo-opencode/src/features/cross-project-mailbox/presence/`): Update `PresenceRecord`, `writePresenceRecord`, `isPresenceRecord`, `readPresenceDetail`, and presence tests to include `protocolVersion`.
  - **QA Scenario**: Run `bun test packages/omo-opencode/src/features/cross-project-mailbox/presence/`. Expect `writePresenceRecord()` to output `protocolVersion: 2` and `readPresenceDetail()` to return `protocolVersion` (defaulting to 1 for legacy records without `protocolVersion`).
- [x] 3. MailboxStore Cross-Batch Supersession (`packages/omo-opencode/src/features/cross-project-mailbox/mailbox/mailbox-store.ts`): Implement `markSuperseded()`, update `drainUnread()` and `ack()` to quarantine unread superseded notes and archive/mark processed superseded notes.
  - **QA Scenario**: Run `bun test packages/omo-opencode/src/features/cross-project-mailbox/mailbox/mailbox-store.test.ts`. Verify that when Note B supersedes Note A: (a) if Note A is in `inbox`, Note A is quarantined/moved so it is not drained; (b) if Note A is in `processed/`, Note A is moved to `processed/superseded/` and Note B retains `supersedesDelivered: true`.
- [x] 4. Unit & Integration Testing (`packages/omo-opencode/src/features/cross-project-mailbox/`): Add unit tests in `mailbox-store.test.ts`, `schema.test.ts`, `presence-record.test.ts`, and `idle-drain-hook.test.ts` covering cross-batch supersession and protocol version compatibility.
  - **QA Scenario**: Run `bun test packages/omo-opencode/src/features/cross-project-mailbox/`. Expect all 100+ mailbox unit and integration tests to pass cleanly with 0 failures.
- [x] 5. Documentation & Roadmap Update (`docs/reference/cross-project-mailbox.md` and `.omo/plans/tooling-improvement-roadmap.md`): Document protocol v2 and cross-batch supersession rules.
  - **QA Scenario**: Inspect `docs/reference/cross-project-mailbox.md` and `.omo/plans/tooling-improvement-roadmap.md`; verify protocol v2 schema, presence handshake versioning, and cross-batch supersession semantics are fully documented.

## Final Verification Wave

- [x] F1. Syntax & Schema Verification (`bun run build:schema` & `bun run typecheck`)
- [x] F2. Diagnostic Inspection (`aft_inspect`)
- [x] F3. Unit Test Suite (`bun test packages/omo-opencode/src/features/cross-project-mailbox/`)
- [x] F4. Clean Workspace & Evidence Check (`git status`)
