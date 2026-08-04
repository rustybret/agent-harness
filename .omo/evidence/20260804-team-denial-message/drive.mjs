// Drives the REAL team-tool-gating hook with the EXACT ids from the production failure:
// a session that was the team's lead, calling with a teamRunId carrying two stray trailing chars.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const { createTeamToolGating } = await import(
  "../../packages/omo-opencode/src/hooks/team-tool-gating/hook.ts"
)
const { registerTeamSession, clearTeamSessionRegistry } = await import(
  "../../packages/omo-opencode/src/features/team-mode/team-session-registry.ts"
)

// The real values, from the session database.
const REAL_TEAM_ID = "2daf76b6-acce-4fd9-bc23-9a9eab4818d8"
const TYPO_TEAM_ID = "2daf76b6-acce-4fd9-bc23-9a9eab4818d8f8"
const SESSION = "ses_04bbceb75ffe3GgV2gzHEdaS0D"

const baseDir = mkdtempSync(path.join(tmpdir(), "team-denial-qa-"))
const teamDir = path.join(baseDir, REAL_TEAM_ID)
mkdirSync(teamDir, { recursive: true })
writeFileSync(
  path.join(teamDir, "state.json"),
  JSON.stringify({
    teamRunId: REAL_TEAM_ID,
    teamName: "qa-team",
    status: "active",
    leadSessionId: SESSION,
    members: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
)

clearTeamSessionRegistry()
registerTeamSession(SESSION, { teamRunId: REAL_TEAM_ID, memberName: "", role: "lead" })

const hook = createTeamToolGating({}, { enabled: true, base_dir: baseDir })

async function attempt(teamRunId) {
  try {
    await hook["tool.execute.before"](
      { tool: "team_send_message", sessionID: SESSION, callID: "qa" },
      { args: { teamRunId, to: "*", body: "qa" } },
    )
    return { teamRunId, outcome: "allowed" }
  } catch (error) {
    return {
      teamRunId,
      outcome: "denied",
      // The typo id CONTAINS the real id as a prefix, so a substring check on the id alone would
      // match either way. Test for the corrective sentence instead.
      namesOwnTeam: /This session is the (lead|member) of team /.test(error.message),
      error: error.message,
    }
  }
}

const results = [await attempt(REAL_TEAM_ID), await attempt(TYPO_TEAM_ID)]
console.log(JSON.stringify({ session: SESSION, results }, null, 2))
process.exit(0)
