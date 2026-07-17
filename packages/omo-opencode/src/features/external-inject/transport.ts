import { timingSafeEqual } from "node:crypto"
import { createServer, type Server } from "node:http"

// Loopback HTTP transport adapted from AFT's MIT rpc-server
// (github.com/cortexkit/aft, packages/opencode-plugin/src/shared/rpc-server.ts):
// dual Bun/Node serve on 127.0.0.1:0, unref'd so it never keeps the process
// alive. Trimmed to plain request routing — no WebSocket/notification-sink.

export const MAX_BODY_BYTES = 1_048_576

export interface InjectRequest {
  readonly method: string
  readonly body: Record<string, unknown>
}

export interface InjectResponse {
  readonly status: number
  readonly body: unknown
}

export type RequestRouter = (req: InjectRequest) => Promise<InjectResponse>

/** Constant-time token compare (length-safe). */
export function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8")
  const b = Buffer.from(expected, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface BunRuntime {
  readonly serve: (options: {
    port: number
    hostname: string
    fetch: (req: Request) => Promise<Response> | Response
  }) => { port?: number; stop: (closeActive?: boolean) => void }
}

function bunRuntime(): BunRuntime | undefined {
  return (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function routeFetch(req: Request, router: RequestRouter): Promise<Response> {
  const url = new URL(req.url)

  if (req.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ok: true, pid: process.pid }, 200)
  }

  if (req.method !== "POST" || !url.pathname.startsWith("/rpc/")) {
    return jsonResponse({ error: "Not Found" }, 404)
  }

  const bodyText = await req.text()
  if (bodyText.length > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request too large" }, 413)
  }

  let body: Record<string, unknown> = {}
  try {
    if (bodyText.length > 0) body = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400)
  }

  const result = await router({ method: url.pathname.slice("/rpc/".length), body })
  return jsonResponse(result.body, result.status)
}

export interface LoopbackServer {
  readonly port: number
  stop(): void
}

/** Start on 127.0.0.1:0, returning the bound port. Prefers Bun, falls back to Node. */
export async function startLoopbackServer(router: RequestRouter): Promise<LoopbackServer> {
  const bun = bunRuntime()
  if (bun) {
    const server = bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => routeFetch(req, router),
    })
    return {
      port: server.port ?? 0,
      stop: () => server.stop(true),
    }
  }
  return startNodeServer(router)
}

async function startNodeServer(router: RequestRouter): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = []
      let size = 0
      let aborted = false
      req.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          aborted = true
          res.writeHead(413, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Request too large" }))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on("end", () => {
        if (aborted) return
        void handleNodeRequest(req, res, Buffer.concat(chunks).toString("utf8"), router)
      })
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to resolve loopback server address"))
        return
      }
      resolve({ port: addr.port, stop: () => server.close() })
    })
    server.unref()
  })
}

async function handleNodeRequest(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  bodyText: string,
  router: RequestRouter,
): Promise<void> {
  const write = (status: number, body: unknown): void => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1")

  if (req.method === "GET" && url.pathname === "/health") {
    write(200, { ok: true, pid: process.pid })
    return
  }
  if (req.method !== "POST" || !url.pathname.startsWith("/rpc/")) {
    write(404, { error: "Not Found" })
    return
  }

  let body: Record<string, unknown> = {}
  try {
    if (bodyText.length > 0) body = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    write(400, { error: "Invalid JSON" })
    return
  }

  const result = await router({ method: url.pathname.slice("/rpc/".length), body })
  write(result.status, result.body)
}
