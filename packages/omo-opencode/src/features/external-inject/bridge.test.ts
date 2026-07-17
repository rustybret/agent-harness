/// <reference types="bun-types" />

import { describe, expect, it, afterEach, beforeEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import type { ExternalInjectConfig } from "../../config/schema/external-inject"
import type { InternalPromptDispatchArgs, InternalPromptDispatchResult } from "../../shared/prompt-async-gate"
import { startExternalInjectBridge, type ExternalInjectBridge } from "./bridge"

const bridges: ExternalInjectBridge[] = []
let sandbox: string
let prevXdg: string | undefined

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), "ext-inject-bridge-"))
  prevXdg = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = sandbox
})

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.stop()
  if (prevXdg === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = prevXdg
  rmSync(sandbox, { recursive: true, force: true })
})

function config(overrides: Partial<ExternalInjectConfig> = {}): ExternalInjectConfig {
  return {
    enabled: true,
    allow_default_active_session: true,
    max_text_bytes: 8192,
    rate_limit: { max: 20, window_ms: 60_000 },
    ...overrides,
  }
}

function makeDispatch(): {
  dispatch: (args: InternalPromptDispatchArgs) => Promise<InternalPromptDispatchResult>
  calls: InternalPromptDispatchArgs[]
} {
  const calls: InternalPromptDispatchArgs[] = []
  return {
    calls,
    dispatch: async (args) => {
      calls.push(args)
      return { status: "dispatched", response: {} }
    },
  }
}

async function start(
  cfg: ExternalInjectConfig,
  dispatch: (args: InternalPromptDispatchArgs) => Promise<InternalPromptDispatchResult>,
): Promise<ExternalInjectBridge> {
  const bridge = await startExternalInjectBridge({
    config: cfg,
    client: { session: { promptAsync: async () => ({}) } },
    directory: sandbox,
    dispatchInternalPrompt: dispatch,
  })
  bridges.push(bridge)
  return bridge
}

async function readToken(bridge: ExternalInjectBridge): Promise<string> {
  // The token is written to the port file; the describe endpoint needs it, so
  // read it back the way an external caller would.
  const dir = path.join(process.env.XDG_DATA_HOME!, "oh-my-opencode", "external-inject", "rpc")
  const { readdirSync, readFileSync } = await import("node:fs")
  const projectDirs = readdirSync(dir)
  for (const p of projectDirs) {
    const portsDir = path.join(dir, p, "ports")
    for (const f of readdirSync(portsDir)) {
      const rec = JSON.parse(readFileSync(path.join(portsDir, f), "utf-8")) as { port: number; token: string }
      if (rec.port === bridge.port) return rec.token
    }
  }
  throw new Error("token not found")
}

function url(bridge: ExternalInjectBridge, p: string): string {
  return `http://127.0.0.1:${bridge.port}${p}`
}

describe("external-inject bridge", () => {
  it("#given a started bridge #then writes a discoverable port file with a token", async () => {
    const { dispatch } = makeDispatch()
    const bridge = await start(config(), dispatch)
    const token = await readToken(bridge)
    expect(bridge.port).toBeGreaterThan(0)
    expect(token.length).toBeGreaterThan(0)
  })

  it("#given no live session #then inject returns 409 no-active-session", async () => {
    const { dispatch } = makeDispatch()
    const bridge = await start(config(), dispatch)
    const token = await readToken(bridge)
    const res = await fetch(url(bridge, "/rpc/inject"), {
      method: "POST",
      body: JSON.stringify({ token, text: "compile error" }),
    })
    expect(res.status).toBe(409)
  })

  it("#given a live session #then default addressing injects into it (202) via the gate", async () => {
    const { dispatch, calls } = makeDispatch()
    const bridge = await start(config(), dispatch)
    const token = await readToken(bridge)
    bridge.tracker.recordActivity("ses_live")
    const res = await fetch(url(bridge, "/rpc/inject"), {
      method: "POST",
      body: JSON.stringify({ token, text: "compile error" }),
    })
    expect(res.status).toBe(202)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sessionID).toBe("ses_live")
  })

  it("#given a bad token #then inject returns 403 and never calls the gate", async () => {
    const { dispatch, calls } = makeDispatch()
    const bridge = await start(config(), dispatch)
    bridge.tracker.recordActivity("ses_live")
    const res = await fetch(url(bridge, "/rpc/inject"), {
      method: "POST",
      body: JSON.stringify({ token: "wrong", text: "x" }),
    })
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it("#given a burst of identical events #then coalesces to a single gate dispatch", async () => {
    const { dispatch, calls } = makeDispatch()
    const bridge = await start(config(), dispatch)
    const token = await readToken(bridge)
    bridge.tracker.recordActivity("ses_live")
    for (let i = 0; i < 4; i += 1) {
      await fetch(url(bridge, "/rpc/inject"), {
        method: "POST",
        body: JSON.stringify({ token, text: "same error" }),
      })
    }
    expect(calls).toHaveLength(1)
  })

  it("#given over-limit distinct events #then returns 429", async () => {
    const { dispatch } = makeDispatch()
    const bridge = await start(config({ rate_limit: { max: 2, window_ms: 60_000 } }), dispatch)
    const token = await readToken(bridge)
    bridge.tracker.recordActivity("ses_live")
    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(url(bridge, "/rpc/inject"), {
        method: "POST",
        body: JSON.stringify({ token, text: `distinct error ${i}` }),
      })
      statuses.push(res.status)
    }
    expect(statuses.filter((s) => s === 202)).toHaveLength(2)
    expect(statuses.filter((s) => s === 429)).toHaveLength(2)
  })

  it("#given stop() #then removes the port file", async () => {
    const { dispatch } = makeDispatch()
    const bridge = await start(config(), dispatch)
    const dir = path.join(process.env.XDG_DATA_HOME!, "oh-my-opencode", "external-inject", "rpc")
    bridge.stop()
    bridges.length = 0
    const { readdirSync } = await import("node:fs")
    let total = 0
    for (const p of readdirSync(dir)) {
      const portsDir = path.join(dir, p, "ports")
      total += readdirSync(portsDir).length
    }
    expect(total).toBe(0)
  })
})
