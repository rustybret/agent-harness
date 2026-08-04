// Replays real stored tool outputs through the REAL json-error-recovery hook and reports how many
// would receive the "you sent invalid JSON" reminder, split by whether the output actually IS an
// argument parse failure. Run against the current working tree to measure the fix.
import { Database } from "bun:sqlite"
import { readdirSync } from "node:fs"
import path from "node:path"

const { createJsonErrorRecoveryHook } = await import(
  "../../packages/omo-opencode/src/hooks/json-error-recovery/index.ts"
)

const hook = createJsonErrorRecoveryHook({ client: {}, directory: process.cwd() })
const handler = hook["tool.execute.after"]

const dbDir = path.join(process.env.HOME, ".local/share/opencode")
const dbs = readdirSync(dbDir).filter((f) => f.endsWith(".db"))

const MARKER = "[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]"
const PREAMBLE = "The arguments provided to the tool are invalid:"

const rows = []
for (const file of dbs) {
  const db = new Database(path.join(dbDir, file), { readonly: true })
  try {
    const q = db.query(
      `SELECT json_extract(data,'$.tool') AS tool,
              json_extract(data,'$.state.output') AS output
       FROM part
       WHERE output IS NOT NULL AND length(output) > 0`,
    )
    for (const r of q.iterate()) {
      if (typeof r.output !== "string" || r.tool === null) continue
      rows.push(r)
    }
  } catch {
    // a db without the expected schema contributes nothing
  } finally {
    db.close()
  }
}

const stats = { scanned: rows.length, injectedTrue: 0, injectedFalse: 0, falseByTool: {} }

for (const row of rows) {
  // Strip any reminder a previous run already appended so the decision is made on the raw output.
  const raw = row.output.split(`\n${MARKER}`)[0].split(MARKER)[0]
  const output = { title: "", output: raw, metadata: {} }
  await handler({ tool: row.tool, sessionID: "replay", callID: "replay" }, output)
  if (!output.output.includes(MARKER)) continue

  const isRealArgumentError = raw.trimStart().startsWith(PREAMBLE)
  if (isRealArgumentError) {
    stats.injectedTrue += 1
  } else {
    stats.injectedFalse += 1
    stats.falseByTool[row.tool] = (stats.falseByTool[row.tool] ?? 0) + 1
  }
}

console.log(JSON.stringify(stats, null, 2))
