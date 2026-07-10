# Momus independent review (round 4) — cross-project-agent-mailbox plan

- Reviewer: momus subagent (Plan Critic)
- Verdict: [OKAY] (round-3 correlationId blocker confirmed resolved; full standards pass clean)
- Non-blocking notes:
  1. Scope line 45 "NEXT session.idle or user-turn boundary" vs Todo 8 "drain ONLY on session.idle"
     is phrasing only — Todo 8 clarifies "wait for NEXT session.idle/user-turn" and QA asserts the
     documented already-idle limitation. Not a contradiction.
  2. Todo 9 send-side access/budget preflight leaves the target-receiver config-loading route implicit;
     worker can reuse existing loadPluginConfig/config-handler against the resolved repoRoot.
- NOTE: Momus reasoning also referenced the OLD Todo 2 "timestamp(ISO8601...)" wording and judged it
  NON-blocking. Codex independently flagged the SAME line as its single round-4 blocker; it is now FIXED
  (Todo 2 states team-core numeric epoch-ms, NOT ISO8601), so both reviewers' concerns are addressed.
