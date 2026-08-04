// Replays REAL sessions that switched agents mid-run through the REAL resolver and the REAL drain
// gate. Message rows come from the live opencode DB and are shaped exactly as the host returns them
// over /session/{id}/message: `{ info: { role, agent, time } }`, oldest-first.
import { Database } from "bun:sqlite"
import os from "node:os"
import path from "node:path"

const { resolveSessionAgent } = await import(
  "../../packages/omo-opencode/src/plugin/session-agent-resolver.ts"
)
const { normalizePrimaryAgent } = await import(
  "../../packages/omo-opencode/src/features/cross-project-mailbox/primary-resolver/resolver.ts"
)
const { evaluateDrainGate } = await import(
  "../../packages/omo-opencode/src/features/cross-project-mailbox/drain-gate/index.ts"
)

const db = new Database(path.join(os.homedir(), ".local/share/opencode/opencode.db"), {
  readonly: true,
})

// The gate config this machine actually runs with.
const config = {
  enabled: true,
  default_sender_access: "allow-none",
  senders: { "some-peer": { access: "allow" } },
  intake_eligible_agents: ["sisyphus", "hephaestus", "atlas"],
}

const switched = db
  .query(
    `WITH ordered AS (
       SELECT session_id, json_extract(data,'$.agent') AS agent, time_created, id,
              ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created ASC, id ASC) AS rn_first,
              ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY time_created DESC, id DESC) AS rn_last
       FROM message WHERE json_extract(data,'$.agent') IS NOT NULL
              AND lower(json_extract(data,'$.agent')) <> 'compaction'
     )
     SELECT f.session_id AS sessionId, f.agent AS firstAgent, l.agent AS lastAgent
     FROM ordered f JOIN ordered l ON f.session_id = l.session_id
     WHERE f.rn_first = 1 AND l.rn_last = 1 AND f.agent <> l.agent
       AND lower(l.agent) <> 'compaction'
     ORDER BY f.session_id DESC LIMIT 40`,
  )
  .all()

function clientFor(sessionId) {
  const rows = db
    .query(
      `SELECT data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC`,
    )
    .all(sessionId)
  // Exactly the host's wire shape: agent lives under info, oldest-first.
  const messages = rows.map((row) => {
    const parsed = JSON.parse(row.data)
    return { info: { role: parsed.role, agent: parsed.agent, time: parsed.time }, parts: [] }
  })
  return { session: { messages: async () => ({ data: messages }) } }
}

let gatedShutWrongly = 0
let drainedWrongly = 0
const samples = []

for (const row of switched) {
  const resolved = normalizePrimaryAgent(await resolveSessionAgent(clientFor(row.sessionId), row.sessionId))
  const actualCurrent = normalizePrimaryAgent(row.lastAgent)
  const verdict = evaluateDrainGate(config, resolved)
  const correctVerdict = evaluateDrainGate(config, actualCurrent)

  const wrong = verdict.allowed !== correctVerdict.allowed
  if (wrong && correctVerdict.allowed) gatedShutWrongly += 1
  if (wrong && !correctVerdict.allowed) drainedWrongly += 1

  if (samples.length < 5) {
    samples.push({
      sessionId: row.sessionId.slice(0, 24),
      startedAs: row.firstAgent,
      runningAs: row.lastAgent,
      resolvedAs: resolved ?? null,
      gateAllows: verdict.allowed,
      shouldAllow: correctVerdict.allowed,
      correct: !wrong,
    })
  }
}

console.log(
  JSON.stringify(
    {
      sessionsReplayed: switched.length,
      wrongGateDecisions: gatedShutWrongly + drainedWrongly,
      gatedShutWrongly,
      drainedWrongly,
      samples,
    },
    null,
    2,
  ),
)
process.exit(0)
