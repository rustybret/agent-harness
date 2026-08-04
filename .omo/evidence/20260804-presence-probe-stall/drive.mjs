// Drives the REAL outbound-budget read path against the REAL presence records on this machine,
// plus a synthetic worst case where every target is a hung port (accepts TCP, never answers) -
// the exact shape that produced "The operation timed out." in the live plugin log.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "../..")
const { validatePluginConfig } = await import(path.join(root, "packages/omo-opencode/src/config/validate.ts"))
const { readOutboundBudget } = await import(
  path.join(root, "packages/omo-opencode/src/features/cross-project-mailbox/visibility/outbound-budget.ts")
)
const { readPresenceStatus } = await import(
  path.join(root, "packages/omo-opencode/src/features/cross-project-mailbox/presence/index.ts")
)
const { createProjectRegistry } = await import(
  path.join(root, "packages/omo-opencode/src/features/cross-project-mailbox/registry/project-registry.ts")
)

const config = validatePluginConfig(root).config.cross_project_mailbox
const registry = createProjectRegistry()

// --- real machine state -------------------------------------------------------------------
const liveStart = Date.now()
const liveRows = await readOutboundBudget(config, registry, {
  readPresence: (id) => readPresenceStatus(id),
})
const liveElapsed = Date.now() - liveStart

// --- synthetic worst case: every target unresponsive --------------------------------------
// One socket that accepts but never replies; every fake presence record points at it.
const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {} } })
const hungUrl = `http://127.0.0.1:${server.port}/`

const home = mkdtempSync(path.join(os.tmpdir(), "omo-presence-qa-"))
mkdirSync(path.join(home, ".omo/presence"), { recursive: true })
const targets = Object.entries(config.senders ?? {})
  .filter(([, sender]) => sender.access === "allow")
  .map(([id]) => id)
for (const id of targets) {
  writeFileSync(
    path.join(home, ".omo/presence", `${id}.json`),
    JSON.stringify({
      projectId: id,
      repoRoot: "/tmp/qa",
      mode: "external",
      serverUrl: hungUrl,
      sessionId: `ses_qa_${id}`,
      pid: process.pid,
      heartbeatTs: Date.now(),
    }),
  )
}

const hungStart = Date.now()
const hungRows = await readOutboundBudget(config, registry, {
  readPresence: (id) => readPresenceStatus(id, home),
})
const hungElapsed = Date.now() - hungStart

server.stop()
rmSync(home, { recursive: true, force: true })

const byStatus = {}
for (const row of liveRows) byStatus[row.presence] = (byStatus[row.presence] ?? 0) + 1

console.log(
  JSON.stringify(
    {
      targets: liveRows.length,
      realMachineState: { elapsedMs: liveElapsed, byStatus },
      allTargetsHung: {
        elapsedMs: hungElapsed,
        rows: hungRows.length,
        serialWorstCaseMs: targets.length * 2000,
        singleProbeTimeoutMs: 2000,
      },
    },
    null,
    2,
  ),
)
