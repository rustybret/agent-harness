/// <reference types="bun-types" />

import { describe, expect, it, afterEach } from "bun:test"

import { createRequestRouter, type HandlerDeps } from "./handler"
import { startLoopbackServer, type LoopbackServer } from "./transport"

const servers: LoopbackServer[] = []

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    token: "secret-token",
    maxTextBytes: 32,
    allowDefaultActiveSession: true,
    rateLimit: { max: 20, window_ms: 60_000 },
    inject: async (payload) => ({ status: 202, body: { status: "accepted", text: payload.text } }),
    ...overrides,
  }
}

async function startServer(deps: HandlerDeps): Promise<LoopbackServer> {
  const server = await startLoopbackServer(createRequestRouter(deps))
  servers.push(server)
  return server
}

function url(server: LoopbackServer, pathname: string): string {
  return `http://127.0.0.1:${server.port}${pathname}`
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop()
})

describe("external-inject loopback listener", () => {
  it("#given a running server #then binds a loopback port", async () => {
    const server = await startServer(makeDeps())
    expect(server.port).toBeGreaterThan(0)
  })

  it("#given GET /health #then returns ok with pid, no auth", async () => {
    const server = await startServer(makeDeps())
    const res = await fetch(url(server, "/health"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; pid: number }
    expect(body.ok).toBe(true)
    expect(body.pid).toBe(process.pid)
  })

  it("#given a bad token #then rejects inject with 403", async () => {
    const server = await startServer(makeDeps())
    const res = await fetch(url(server, "/rpc/inject"), {
      method: "POST",
      body: JSON.stringify({ token: "wrong", text: "hi" }),
    })
    expect(res.status).toBe(403)
  })

  it("#given a valid token + text #then accepts inject with 202", async () => {
    const server = await startServer(makeDeps())
    const res = await fetch(url(server, "/rpc/inject"), {
      method: "POST",
      body: JSON.stringify({ token: "secret-token", text: "hi" }),
    })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { status: string; text: string }
    expect(body.status).toBe("accepted")
    expect(body.text).toBe("hi")
  })

  it("#given oversize text #then rejects inject with 413", async () => {
    const server = await startServer(makeDeps({ maxTextBytes: 4 }))
    const res = await fetch(url(server, "/rpc/inject"), {
      method: "POST",
      body: JSON.stringify({ token: "secret-token", text: "way too long for four bytes" }),
    })
    expect(res.status).toBe(413)
  })

  it("#given describe #then returns capability metadata", async () => {
    const server = await startServer(makeDeps())
    const res = await fetch(url(server, "/rpc/describe"), {
      method: "POST",
      body: JSON.stringify({ token: "secret-token" }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      version: number
      methods: string[]
      addressing_modes: string[]
      max_text_bytes: number
      rate_limit: { max: number; window_ms: number }
    }
    expect(body.version).toBe(1)
    expect(body.methods).toContain("inject")
    expect(body.addressing_modes).toContain("active-session")
    expect(body.max_text_bytes).toBe(32)
    expect(body.rate_limit.max).toBe(20)
  })

  it("#given an unknown rpc method #then returns 404", async () => {
    const server = await startServer(makeDeps())
    const res = await fetch(url(server, "/rpc/bogus"), {
      method: "POST",
      body: JSON.stringify({ token: "secret-token" }),
    })
    expect(res.status).toBe(404)
  })

  it("#given describe with allow_default_active_session false #then omits active-session mode", async () => {
    const server = await startServer(makeDeps({ allowDefaultActiveSession: false }))
    const res = await fetch(url(server, "/rpc/describe"), {
      method: "POST",
      body: JSON.stringify({ token: "secret-token" }),
    })
    const body = (await res.json()) as { addressing_modes: string[] }
    expect(body.addressing_modes).not.toContain("active-session")
    expect(body.addressing_modes).toContain("explicit-session-id")
  })
})
