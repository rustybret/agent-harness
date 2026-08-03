import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { emitMailboxTrace } from "./emit-trace"
import { createFileTraceSink, traceLogPath } from "./trace-log"

describe("createFileTraceSink", () => {
  let repoRoot: string

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "mailbox-trace-"))
  })

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true })
  })

  it("appends one JSON line per record under .omo/mailbox-trace.jsonl", async () => {
    // given
    const sink = createFileTraceSink(repoRoot)
    // when
    await sink.append({ phase: "sent", messageId: "m1", correlationId: "c1", at: 1 })
    await sink.append({ phase: "acked", messageId: "m1", correlationId: "c1", at: 2 })
    // then
    const content = await readFile(traceLogPath(repoRoot), "utf8")
    const lines = content.trimEnd().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ phase: "sent", messageId: "m1" })
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ phase: "acked", messageId: "m1" })
  })

  it("targets .omo/mailbox-trace.jsonl adjacent to the outbox log", () => {
    // when / then
    expect(traceLogPath("/repo")).toBe("/repo/.omo/mailbox-trace.jsonl")
  })

  it("writes an integer seq on records emitted through the real file sink", async () => {
    // given
    const sink = createFileTraceSink(repoRoot)
    // when
    emitMailboxTrace({ phase: "sent", messageId: "m1", correlationId: "c1", at: 1 }, { repoRoot, sink, logger: () => {} })
    emitMailboxTrace({ phase: "acked", messageId: "m1", correlationId: "c1", at: 1 }, { repoRoot, sink, logger: () => {} })
    await new Promise((resolve) => setTimeout(resolve, 20))
    // then
    const content = await readFile(traceLogPath(repoRoot), "utf8")
    const records = content.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records).toHaveLength(2)
    const seqs = records.map((record) => record["seq"] as number)
    expect(seqs.every((seq) => Number.isInteger(seq))).toBe(true)
    expect(seqs[0]).not.toBe(seqs[1])
    const bySeq = [...records].sort((left, right) => (left["seq"] as number) - (right["seq"] as number))
    expect(bySeq.map((record) => record["phase"])).toEqual(["sent", "acked"])
  })
})
