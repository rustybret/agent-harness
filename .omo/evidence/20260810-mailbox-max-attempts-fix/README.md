# QA Evidence: Mailbox Max Delivery Attempts & Quarantine Fix

**Date:** 2026-08-10  
**Target Package:** `packages/omo-opencode/src/features/cross-project-mailbox/`  
**Issue:** Inbound notes were being redelivered infinitely when prompt dispatch was rejected (e.g. `primary-not-eligible` or prompt gate rejection), resulting in infinite `rolled-back` trace events (69 occurrences in `.omo/mailbox-trace.jsonl`).

## 1. What Was Tested
- **Attempt Tracking & Persistence**: Created `DeliveryAttemptsStore` (`coordination_notes/.attempts.json`) to count delivery attempts per `messageId`.
- **Max Retries Bound**: Added `max_delivery_attempts` bound (default: 3) to `CrossProjectMailboxBoundsSchema`.
- **Quarantine Transition**: Updated `idle-drain-processor.ts` so that when an attempt count reaches `max_delivery_attempts`, the note transitions to `quarantined` with reason `"max-retries-exceeded"` instead of unreserving back to `UNREAD`.
- **Attempt Clearing**: Verified that successful dispatch or manual ack clears recorded attempts.

## 2. What Was Observed
- Ran full mailbox test suite (`bun test packages/omo-opencode/src/features/cross-project-mailbox/`):
  - **796 pass, 0 fail across 59 test files**.
- Ran workspace typechecks (`bun run typecheck`):
  - **Passed clean with 0 errors across 37 workspace packages**.
- Sent outbound confirmation note to `uc-studio` (`uc-studio-8ce41322`) via `project_message` (`7cd729cf-26af-4372-b533-6376b34d332b`).

## 3. Evidence Files & Unit Tests
- `packages/omo-opencode/src/features/cross-project-mailbox/mailbox/delivery-attempts-store.ts`
- `packages/omo-opencode/src/features/cross-project-mailbox/mailbox/delivery-attempts-store.test.ts`
- `packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-hook.test.ts` (added `#then quarantines note with max-retries-exceeded when attempt count reaches max_delivery_attempts`)
