// Drives the REAL tool-output-truncator hook against the REAL oversized bash output pulled from the
// live session database, plus a representative small output, and reports what each one became.
import { Database } from "bun:sqlite"
import os from "node:os"
import path from "node:path"

const { createToolOutputTruncatorHook } = await import(
  "../../packages/omo-opencode/src/hooks/tool-output-truncator.ts"
)

const db = new Database(path.join(os.homedir(), ".local/share/opencode/opencode.db"), {
  readonly: true,
})

const biggest = db
  .query(
    `SELECT json_extract(data,'$.state.output') AS output,
            json_extract(data,'$.state.input.command') AS command
     FROM part
     WHERE json_extract(data,'$.type')='tool' AND json_extract(data,'$.tool')='bash'
     ORDER BY length(json_extract(data,'$.state.output')) DESC LIMIT 1`,
  )
  .get()

const typical = db
  .query(
    `SELECT json_extract(data,'$.state.output') AS output
     FROM part
     WHERE json_extract(data,'$.type')='tool' AND json_extract(data,'$.tool')='bash'
       AND length(json_extract(data,'$.state.output')) BETWEEN 500 AND 2000
     LIMIT 1`,
  )
  .get()

// No session context available offline, so getContextWindowUsage returns null and the truncator
// takes its documented conservative fallback path - the same path a real session hits when usage
// cannot be resolved.
const ctx = { client: { session: { messages: async () => ({ data: [] }) } }, directory: process.cwd() }
const hook = createToolOutputTruncatorHook(ctx)

async function run(label, text, command) {
  const output = { title: "Result", output: text, metadata: {} }
  await hook["tool.execute.after"]({ tool: "bash", sessionID: "ses_qa", callID: "call_qa" }, output)
  return {
    label,
    ...(command === undefined ? {} : { command: command.slice(0, 40) }),
    beforeChars: text.length,
    afterChars: output.output.length,
    approxBeforeTokens: Math.round(text.length / 4),
    approxAfterTokens: Math.round(output.output.length / 4),
    changed: output.output !== text,
  }
}

const results = [
  await run("largest real bash output", biggest.output, biggest.command),
  await run("typical bash output", typical.output),
]

console.log(JSON.stringify({ results }, null, 2))
process.exit(0)
