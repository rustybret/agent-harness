import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { appendOutboxLog, type OutboxEntry, outboxLogPath, parseOutboxLine } from "./outbox-log"

let repoRoot: string

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(os.tmpdir(), "cpm-outbox-"))
})

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true })
})

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    sentAt: 1,
    toProjectId: "proj-b",
    toRepoRoot: "/tmp/proj-b",
    messageId: "msg-1",
    intent: "quick",
    correlationId: "corr-1",
    body: "hello",
    ...overrides,
  }
}

describe("appendOutboxLog", () => {
  it("serializes toRepoRoot into the outbox line", async () => {
    // given
    const written = entry({ toRepoRoot: "/tmp/target-repo" })

    // when
    await appendOutboxLog(repoRoot, written)
    const raw = await readFile(outboxLogPath(repoRoot), "utf8")
    const parsed = JSON.parse(raw.trim()) as { toRepoRoot?: string }

    // then
    expect(parsed.toRepoRoot).toBe("/tmp/target-repo")
  })
})

describe("parseOutboxLine", () => {
  it("returns a valid entry for a new line that includes toRepoRoot", () => {
    // given
    const line = JSON.stringify(entry({ toRepoRoot: "/tmp/target-repo" }))

    // when
    const parsed = parseOutboxLine(line)

    // then
    expect(parsed).not.toBeNull()
    expect(parsed?.toProjectId).toBe("proj-b")
    expect(parsed?.toRepoRoot).toBe("/tmp/target-repo")
  })

  it("parses a legacy line missing toRepoRoot as undefined without throwing", () => {
    // given
    const legacy = JSON.stringify({
      sentAt: 1,
      toProjectId: "proj-b",
      messageId: "msg-1",
      intent: "quick",
      correlationId: "corr-1",
      body: "hello",
    })

    // when
    const parsed = parseOutboxLine(legacy)

    // then
    expect(parsed).not.toBeNull()
    expect(parsed?.toProjectId).toBe("proj-b")
    expect(parsed?.toRepoRoot).toBeUndefined()
  })

  it("returns null for an unparseable line", () => {
    // given
    const garbage = "{not json"

    // when
    const parsed = parseOutboxLine(garbage)

    // then
    expect(parsed).toBeNull()
  })
})
