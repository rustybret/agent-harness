import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { DeliveryAttemptsStore } from "./delivery-attempts-store"

describe("DeliveryAttemptsStore", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "attempts-store-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("returns 0 for unrecorded message", async () => {
    const store = new DeliveryAttemptsStore(tmpDir)
    expect(await store.getAttempts("msg_1")).toBe(0)
  })

  it("increments attempt count atomically", async () => {
    const store = new DeliveryAttemptsStore(tmpDir)
    expect(await store.incrementAttempts("msg_1")).toBe(1)
    expect(await store.incrementAttempts("msg_1")).toBe(2)
    expect(await store.getAttempts("msg_1")).toBe(2)
  })

  it("clears attempt count", async () => {
    const store = new DeliveryAttemptsStore(tmpDir)
    await store.incrementAttempts("msg_1")
    await store.clearAttempts("msg_1")
    expect(await store.getAttempts("msg_1")).toBe(0)
  })
})
