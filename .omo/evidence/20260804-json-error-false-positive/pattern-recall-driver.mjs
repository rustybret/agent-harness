// Measures, on RAW stored outputs with any previously-appended reminder stripped, how many real
// argument parse failures each pattern set recognizes. Answers whether adding /json parsing failed/
// changes recall, independent of the preamble gate.
import { Database } from "bun:sqlite"
import { readdirSync } from "node:fs"
import path from "node:path"

const OLD = [
  /json parse error/i,
  /failed to parse json/i,
  /invalid json/i,
  /malformed json/i,
  /unexpected end of json input/i,
  /syntaxerror:\s*unexpected token.*json/i,
  /json[^\n]*expected '\}'/i,
  /json[^\n]*unexpected eof/i,
]
const NEW = [/json parsing failed/i, ...OLD]

const MARKER = "[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]"
const PREAMBLE = "The arguments provided to the tool are invalid:"

const dbDir = path.join(process.env.HOME, ".local/share/opencode")
const stats = { argErrors: 0, oldMatched: 0, newMatched: 0, onlyNew: 0 }

for (const file of readdirSync(dbDir).filter((f) => f.endsWith(".db"))) {
  const db = new Database(path.join(dbDir, file), { readonly: true })
  try {
    const q = db.query(
      `SELECT json_extract(data,'$.state.output') AS output FROM part
       WHERE output LIKE 'The arguments provided to the tool are invalid:%'`,
    )
    for (const r of q.iterate()) {
      if (typeof r.output !== "string") continue
      const raw = r.output.split(`\n${MARKER}`)[0].split(MARKER)[0]
      if (!raw.trimStart().startsWith(PREAMBLE)) continue
      stats.argErrors += 1
      const old = OLD.some((p) => p.test(raw))
      const nu = NEW.some((p) => p.test(raw))
      if (old) stats.oldMatched += 1
      if (nu) stats.newMatched += 1
      if (nu && !old) stats.onlyNew += 1
    }
  } catch {
    // schema mismatch contributes nothing
  } finally {
    db.close()
  }
}

console.log(JSON.stringify(stats, null, 2))
