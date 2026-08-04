// Drives the REAL readPresenceStatus against three peers:
//   1. a healthy HTTP server        -> must be live
//   2. a bound-but-unresponsive peer -> the production shape (busy mid-turn)
//   3. a port nothing is bound to    -> must be offline/stale
import net from "node:net"
import http from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const { readPresenceStatus } = await import(
  "../../packages/omo-opencode/src/features/cross-project-mailbox/presence/presence-reader.ts"
)

const home = mkdtempSync(path.join(tmpdir(), "presence-qa-"))
mkdirSync(path.join(home, ".omo", "presence"), { recursive: true })

function writeRecord(projectId, serverUrl) {
  writeFileSync(
    path.join(home, ".omo", "presence", `${projectId}.json`),
    JSON.stringify({
      projectId,
      repoRoot: "/tmp/qa-repo",
      mode: "external",
      serverUrl,
      sessionId: `ses_${projectId}`,
      pid: process.pid,
      heartbeatTs: Date.now(),
    }),
  )
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return server.address().port
}

const healthy = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify({ healthy: true }))
})
// Accepts the connection and then does nothing - exactly what a session mid-turn looks like to a
// probe whose deadline expires before the reply is queued.
const busy = net.createServer(() => {})

const healthyPort = await listen(healthy)
const busyPort = await listen(busy)

const deadServer = net.createServer(() => {})
const deadPort = await listen(deadServer)
await new Promise((resolve) => deadServer.close(resolve))

writeRecord("healthy-peer", `http://127.0.0.1:${healthyPort}`)
writeRecord("busy-peer", `http://127.0.0.1:${busyPort}`)
writeRecord("dead-peer", `http://127.0.0.1:${deadPort}`)

const results = {}
for (const id of ["healthy-peer", "busy-peer", "dead-peer"]) {
  const started = Date.now()
  // probeTimeoutMs mirrors the production 2s ceiling; the busy peer is what blows past it.
  const status = await readPresenceStatus(id, home)
  results[id] = { status, elapsedMs: Date.now() - started }
}

console.log(JSON.stringify(results, null, 2))

healthy.close()
busy.close()
process.exit(0)
