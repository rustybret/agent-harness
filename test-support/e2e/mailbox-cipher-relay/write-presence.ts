import { writePresenceRecord } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/presence/presence-record"
import { readFile } from "node:fs/promises"

const contextPath = process.argv[2]
if (!contextPath) {
  console.error("Usage: bun write-presence.ts <contextPath>")
  process.exit(1)
}

const context = JSON.parse(await readFile(contextPath, "utf8"))
const homeDir = context.home

for (const project of context.projects) {
  const record = {
    projectId: project.projectId,
    repoRoot: project.root,
    mode: "external" as const,
    serverUrl: `http://127.0.0.1:${project.port}`,
    sessionId: `ses_manual_${project.name}`,
    pid: process.pid,
    heartbeatTs: Date.now(),
  }
  await writePresenceRecord(record, homeDir)
  console.log(`Wrote presence for ${project.name} (${project.projectId})`)
}
