// Rewrites EVERY vendored skill's frontmatter MCP url in the scratch vendored-skills
// copy to the fixture port (never 27182). All six skills declare the SAME server name
// "supermcp", so skill_mcp(mcp_name="supermcp") resolves across ALL loaded skills — if
// even one still points at 27182 the call can leak to the real bridge. Rewriting all
// six closes that leak. Only touches the SCRATCH dir passed in argv[1]; the real
// packages/supermcp-skills/ is never given to this script.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"

const skillsDir = process.argv[2]
const port = process.argv[3]
if (!skillsDir || !port) {
  console.error("usage: node rewrite-all-urls.mjs <vendored-skills-dir> <port>")
  process.exit(2)
}
if (port === "27182") {
  console.error("refusing to rewrite to reserved bridge port 27182")
  process.exit(2)
}

let rewrote = 0
for (const name of readdirSync(skillsDir)) {
  const skillMd = join(skillsDir, name, "SKILL.md")
  try {
    if (!statSync(skillMd).isFile()) continue
  } catch {
    continue
  }
  const before = readFileSync(skillMd, "utf8")
  const after = before.replace(/http:\/\/127\.0\.0\.1:\d+\/mcp/g, `http://127.0.0.1:${port}/mcp`)
  if (after !== before) {
    writeFileSync(skillMd, after)
    const line = after.split("\n").find((l) => l.includes("url:"))?.trim() ?? "(no url line)"
    console.log(`rewrote ${name}: ${line}`)
    rewrote += 1
  }
}
if (rewrote === 0) {
  console.error("no url rewrites applied (pattern not found in any skill)")
  process.exit(3)
}
console.log(`total skills rewritten: ${rewrote}`)
