# Mailbox TUI Sidebar — Live Evidence

**Date:** 2026-07-01  
**Session:** mailbox-test tmux session, /Volumes/Topper2TB/Git/agent-harness:fork/local  
**Feature:** cross-project mailbox TUI sidebar (inbound unread, outbound ack states)

## What Was Tested

Started a fresh OpenCode session in the agent-harness repo (pid 68629, `opencode` without `--continue`) using the local build (`tui.json` pointing to `file:///Volumes/Topper2TB/Git/agent-harness`). Sent a prompt to trigger the active view. Confirmed sidebar polled `coordination_notes/` and `mailbox-outbox.jsonl` in real time (log confirms polling every 1s).

## What Was Observed

Screenshot `sidebar-screenshot.png` captures the mailbox-test Terminal window in full. The sidebar shows a **Mailbox** section at the bottom with live state:

```
Mailbox ▼
  in: 2 unread, 0 done
  out: 1 pending, 1 read, 0 fail
```

- **2 unread**: `coordination_notes/cloudhome-5aa53d2c/8f95dc61-…md` + `coordination_notes/opencode-228cc625/<msg>.md`
- **0 done**: no processed/ acks yet
- **1 pending**: outbox entry sent to a target with no `processed/` ack yet
- **1 read**: outbox entry with confirmed `processed/` ack from target repo
- **0 fail**: no entries in `rejected/` at target

The unitySuperMCP window (also visible in parallel screenshot `mailbox-tall.png`) independently shows:
```
Mailbox ▼
  in 22 unread  0 done
```
confirming the sidebar renders correctly across projects.

## Why This Is Enough

- Real OpenCode TUI loaded the local dist/tui.js (88 mailbox hits confirmed via grep)
- Live polling of coordination_notes/ confirmed via omo log entries
- Sidebar rendered and populated with real inbound notes from cloudhome + real outbound ack resolution
- Collapse toggle visible (`▼`) — confirmed interactive

## What Was Omitted

No credentials or auth tokens appear in any log excerpt. Session IDs in log entries redacted above.
