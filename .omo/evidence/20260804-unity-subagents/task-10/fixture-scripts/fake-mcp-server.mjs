// Throwaway fixture MCP server for the unity-supermcp-subagents task-10 QA.
// Speaks streamable-HTTP MCP (the same transport skill-mcp-manager's HTTP client
// uses: StreamableHTTPClientTransport). Binds a RANDOM free port (NEVER 27182,
// which is reserved for the real Unity SuperMCP bridge). Exposes four stub tools
// with canned JSON responses and appends an ordered, timestamped request log so
// the driver can assert the exact call order the restricted Unity agents made.
//
// Session-aware: a transport is created on the initialize request and reused for
// subsequent calls keyed by the mcp-session-id header (the standard streamable
// HTTP server pattern), so the initialized notification and tools/call land on
// the same initialized server.
//
// Env:
//   FIXTURE_LOG   path to the append-only ordered request log (required)
//   FIXTURE_PORT  fixed port to bind (default 0 = random free port)
//
// On listen it prints one line to stdout: FIXTURE_READY <port>
// so the launcher can capture the chosen port without racing.

import { createServer } from "node:http"
import { appendFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"

const LOG = process.env.FIXTURE_LOG
if (!LOG) {
  process.stderr.write("FIXTURE_LOG env is required\n")
  process.exit(2)
}
const PORT = Number(process.env.FIXTURE_PORT ?? 0)
if (PORT === 27182) {
  process.stderr.write("refusing to bind reserved Unity bridge port 27182\n")
  process.exit(2)
}

let seq = 0
function logEvent(entry) {
  seq += 1
  const line = JSON.stringify({ seq, ts: new Date().toISOString(), ...entry })
  appendFileSync(LOG, `${line}\n`)
}

// Canned responses shaped like the real bridge tools return.
const CANNED = {
  bridge_status: {
    ok: true,
    editor_focused: true,
    last_pump_tick_age_ms: 12,
    run_in_background: true,
    pending_modal_count: 0,
    fixture: true,
  },
  get_relevant_tools: {
    role: "scene",
    tools: ["scene_list", "gameobject_get", "gameobject_create", "component_set_property", "session_changes"],
    fixture: true,
  },
  scene_list: {
    scenes: [
      { path: "Assets/Scenes/Main.unity", loaded: true },
      { path: "Assets/Scenes/Menu.unity", loaded: false },
    ],
    fixture: true,
  },
  list_pending_modals: {
    modals: [],
    fixture: true,
  },
}

function makeServer() {
  const server = new McpServer(
    { name: "fixture-supermcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  )

  for (const toolName of Object.keys(CANNED)) {
    server.registerTool(
      toolName,
      {
        description: `Fixture stub for ${toolName}`,
        inputSchema: {},
      },
      async (args) => {
        logEvent({ kind: "tools/call", tool: toolName, args: args ?? null })
        return {
          content: [{ type: "text", text: JSON.stringify(CANNED[toolName]) }],
        }
      },
    )
  }

  return server
}

const transports = new Map()

const httpServer = createServer(async (req, res) => {
  const method = req.method ?? "GET"
  const sessionId = req.headers["mcp-session-id"]

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString("utf8")
  let parsed
  try {
    parsed = raw ? JSON.parse(raw) : undefined
  } catch {
    parsed = undefined
  }
  const rpcMethod = parsed && !Array.isArray(parsed) ? parsed.method : undefined
  logEvent({ kind: "http", httpMethod: method, rpcMethod: rpcMethod ?? null, sessionId: sessionId ?? null })

  try {
    let transport
    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)
    } else if (!sessionId && parsed && isInitializeRequest(parsed)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          transports.set(sid, transport)
          logEvent({ kind: "session_init", sessionId: sid })
        },
      })
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId)
      }
      const server = makeServer()
      await server.connect(transport)
    } else {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: missing session" }, id: null }))
      return
    }
    await transport.handleRequest(req, res, parsed)
  } catch (error) {
    logEvent({ kind: "error", error: error instanceof Error ? error.message : String(error) })
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "fixture error" }, id: null }))
    }
  }
})

httpServer.listen(PORT, "127.0.0.1", () => {
  const addr = httpServer.address()
  const port = typeof addr === "object" && addr ? addr.port : PORT
  logEvent({ kind: "listen", port })
  process.stdout.write(`FIXTURE_READY ${port}\n`)
})

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    logEvent({ kind: "shutdown", signal: sig })
    httpServer.close(() => process.exit(0))
  })
}
