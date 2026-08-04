// A minimal REAL stdio MCP server, so the driver exercises the real MCP protocol path rather than
// a mocked manager. Exposes two tools and rejects anything else the way a real server does.
import { createInterface } from "node:readline"

const TOOLS = [
  { name: "bridge_status", description: "Report bridge status", inputSchema: { type: "object" } },
  { name: "scene_open", description: "Open a scene", inputSchema: { type: "object" } },
]

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`)

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "") return
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-supermcp", version: "1.0.0" },
      },
    })
    return
  }
  if (req.method === "tools/list") {
    send({ jsonrpc: "2.0", id: req.id, result: { tools: TOOLS } })
    return
  }
  if (req.method === "tools/call") {
    const known = TOOLS.some((t) => t.name === req.params?.name)
    if (known) {
      send({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "ok" }] } })
    } else {
      send({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: "Tool not found" } })
    }
    return
  }
  if (req.id !== undefined) {
    send({ jsonrpc: "2.0", id: req.id, result: {} })
  }
})
