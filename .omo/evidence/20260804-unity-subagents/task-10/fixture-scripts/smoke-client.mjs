// Smoke test: connect to the fixture via the SAME transport skill-mcp-manager uses,
// list tools, call one, and print results. Proves the fixture speaks streamable-HTTP MCP.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const url = process.argv[2]
if (!url) {
  console.error("usage: node smoke-client.mjs <url>")
  process.exit(2)
}
const transport = new StreamableHTTPClientTransport(new URL(url))
const client = new Client({ name: "smoke", version: "1.0.0" }, { capabilities: {} })
await client.connect(transport)
const tools = await client.listTools()
const call = await client.callTool({ name: "bridge_status", arguments: {} })
console.log(JSON.stringify({ tools: tools.tools.map((t) => t.name), bridge_status: call.content }, null, 2))
await client.close()
await transport.close()
process.exit(0)
