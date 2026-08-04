// Replays the REAL filePath values from the 39 recorded doubled-path lsp_diagnostics failures
// through the REAL resolver, under the REAL request context, with cwd set to the package root -
// the configuration that produced them.
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const { runWithRequestContext, createStandaloneMcpRequestContext } = await import(
  "../../packages/lsp-core/src/request-context.ts"
)
const { resolvePathInsideContext } = await import(
  "../../packages/lsp-core/src/lsp/client-wrapper.ts"
)

const repoRoot = "/Volumes/Topper2TB/Git/agent-harness"
const packageRoot = path.join(repoRoot, "packages", "omo-opencode")

const db = new Database(path.join(os.homedir(), ".local/share/opencode/opencode.db"), {
  readonly: true,
})

const recorded = db
  .query(
    `SELECT DISTINCT json_extract(data,'$.state.input.filePath') AS filePath
     FROM part
     WHERE json_extract(data,'$.type')='tool'
       AND json_extract(data,'$.state.error') LIKE '%/packages/omo-opencode/packages/%'
       AND json_extract(data,'$.state.input.filePath') NOT LIKE '/%'`,
  )
  .all()

const context = createStandaloneMcpRequestContext({ cwd: packageRoot })

let resolved = 0
let stillMissing = 0
const samples = []

for (const row of recorded) {
  let outcome
  try {
    const abs = runWithRequestContext(context, () => resolvePathInsideContext(row.filePath))
    // The file may have been renamed or deleted since the failure was recorded; what matters is
    // whether the resolver still produces the doubled path.
    const doubled = abs.includes("/packages/omo-opencode/packages/omo-opencode/")
    outcome = doubled ? "doubled" : existsSync(abs) ? "resolved" : "not-doubled-but-absent"
  } catch (error) {
    outcome = `threw: ${error.message.slice(0, 40)}`
  }
  if (outcome === "resolved") resolved += 1
  else stillMissing += 1
  if (samples.length < 3) samples.push({ input: row.filePath.slice(0, 60), outcome })
}

console.log(
  JSON.stringify(
    { recordedFailures: recorded.length, resolvedCorrectly: resolved, notResolved: stillMissing, samples },
    null,
    2,
  ),
)
process.exit(0)
