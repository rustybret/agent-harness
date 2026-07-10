# Decisions — cross-project-agent-mailbox

## Made decisions (DO NOT re-open)
- v1 retrigger: drain ONLY on session.idle. No mailbox_check_now tool, no agent-change listener.
- v1 agent switch: already-idle-then-eligible notes WAIT for next session.idle
- correlationId input: agent supplies `threadId` (fresh send) or nothing (reply uses parent's)
- hopCount/hopPath: NEVER tool inputs — always derived; agent cannot forge
- rate-limited notes: TRANSIENT re-queue (never quarantine); only duplicate-loop quarantines
- ack-state: dispatch_sent => history_confirmed; ONLY history_confirmed may ack()
- receiver policy: default_sender_access + senders map (no nested string[])
- timestamp tiebreak: numeric epoch-ms, larger=newer for supersede chain
