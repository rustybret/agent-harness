import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { portFileDir } from "../../external-inject/port-file"
import { triggerInterruptMailboxDrainNow } from "./interrupt-sender-trigger"

let targetRoot: string
let dataHome: string
let savedXdgDataHome: string | undefined

beforeEach(async () => {
  targetRoot = await mkdtemp(path.join(os.tmpdir(), "cpm-interrupt-target-"))
  dataHome = await mkdtemp(path.join(os.tmpdir(), "cpm-interrupt-xdg-"))
  savedXdgDataHome = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = dataHome
})

afterEach(async () => {
  if (savedXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = savedXdgDataHome
  await rm(targetRoot, { recursive: true, force: true })
  await rm(dataHome, { recursive: true, force: true })
})

describe("triggerInterruptMailboxDrainNow", () => {
  describe("#given a live target bridge port file", () => {
    it("#then posts mailbox_drain_now with the bridge token", async () => {
      // given
      const requests: Array<{ readonly url: string; readonly body: string | null }> = []

      // when
      const result = await triggerInterruptMailboxDrainNow(targetRoot, {
        fetch: async (url, init) => {
          requests.push({ url: url.toString(), body: typeof init?.body === "string" ? init.body : null })
          return new Response(JSON.stringify({ triggered: true }), { status: 200 })
        },
        readPortFile: async () => ({ port: 43123, token: "bridge-token", pid: process.pid, started_at: 2 }),
      })

      // then
      expect(result).toEqual({ triggered: true })
      expect(requests).toEqual([{ url: "http://127.0.0.1:43123/rpc/mailbox_drain_now", body: JSON.stringify({ token: "bridge-token" }) }])
    })
  })

  describe("#given the target has no bridge port file", () => {
    it("#then degrades without surfacing a send failure", async () => {
      // given
      const logs: string[] = []

      // when
      const result = await triggerInterruptMailboxDrainNow(targetRoot, {
        fetch: async () => new Response(null, { status: 500 }),
        log: (message) => logs.push(message),
        readPortFile: async () => null,
      })

      // then
      expect(result).toEqual({ triggered: false })
      expect(logs.some((message) => message.includes("no external-inject bridge port"))).toBe(true)
    })
  })

  describe("#given the bridge is unreachable", () => {
    it("#then logs the failed nudge and still reports an untriggered drain", async () => {
      // given
      const logs: Array<{ readonly message: string; readonly context?: Record<string, unknown> }> = []

      // when
      const result = await triggerInterruptMailboxDrainNow(targetRoot, {
        fetch: async () => {
          throw new TypeError("connection refused")
        },
        log: (message, context) => logs.push({ message, context }),
        readPortFile: async () => ({ port: 43123, token: "bridge-token", pid: process.pid, started_at: 2 }),
      })

      // then
      expect(result).toEqual({ triggered: false })
      expect(logs.some((entry) => entry.message.includes("drain-now nudge failed"))).toBe(true)
    })
  })

  describe("#given multiple stored port files", () => {
    it("#then reads the newest live record from the target project port directory", async () => {
      // given
      const portDir = portFileDir(targetRoot)
      await mkdir(portDir, { recursive: true })
      await writeFile(path.join(portDir, "old.json"), JSON.stringify({ port: 41000, token: "old", pid: process.pid, started_at: 1 }))
      await writeFile(path.join(portDir, "new.json"), JSON.stringify({ port: 42000, token: "new", pid: process.pid, started_at: 2 }))
      const urls: string[] = []

      // when
      const result = await triggerInterruptMailboxDrainNow(targetRoot, {
        fetch: async (url) => {
          urls.push(url.toString())
          return new Response(JSON.stringify({ triggered: true }), { status: 200 })
        },
      })

      // then
      expect(result).toEqual({ triggered: true })
      expect(urls).toEqual(["http://127.0.0.1:42000/rpc/mailbox_drain_now"])
    })
  })
})
