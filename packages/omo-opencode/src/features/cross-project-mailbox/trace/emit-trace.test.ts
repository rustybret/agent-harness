import { describe, expect, it } from "bun:test"

import { emitMailboxTrace, MAILBOX_TRACE_PREFIX } from "./emit-trace"
import { TRACE_DETAIL_PREVIEW_MAX } from "./trace-log"
import { MAILBOX_TRACE_PHASES } from "./types"
import type { MailboxTraceEvent, MailboxTraceSink } from "./types"

function collectingSink(): { records: Record<string, unknown>[]; sink: MailboxTraceSink } {
  const records: Record<string, unknown>[] = []
  return {
    records,
    sink: {
      append(record: Record<string, unknown>): void {
        records.push(record)
      },
    },
  }
}

function collectingLogger(): { lines: { message: string; context: Record<string, unknown> }[]; logger: (m: string, c: Record<string, unknown>) => void } {
  const lines: { message: string; context: Record<string, unknown> }[] = []
  return {
    lines,
    logger: (message: string, context: Record<string, unknown>): void => {
      lines.push({ message, context })
    },
  }
}

function baseEvent(overrides: Partial<MailboxTraceEvent> = {}): MailboxTraceEvent {
  return {
    phase: "sent",
    messageId: "msg-1",
    correlationId: "corr-1",
    at: 1000,
    ...overrides,
  }
}

describe("emitMailboxTrace", () => {
  it("emits exactly one sink line carrying messageId + correlationId for every phase", async () => {
    for (const phase of MAILBOX_TRACE_PHASES) {
      // given
      const { records, sink } = collectingSink()
      const { lines, logger } = collectingLogger()
      // when
      emitMailboxTrace(baseEvent({ phase }), { repoRoot: "/repo", sink, logger })
      await Promise.resolve()
      // then
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ phase, messageId: "msg-1", correlationId: "corr-1" })
      expect(lines).toHaveLength(1)
      expect(lines[0]?.message).toBe(`${MAILBOX_TRACE_PREFIX} ${phase}`)
    }
  })

  it("logs with the stable [mailbox-trace] prefix and the full record as context", async () => {
    // given
    const { sink } = collectingSink()
    const { lines, logger } = collectingLogger()
    // when
    emitMailboxTrace(baseEvent({ phase: "routed", lane: "subagent" }), { repoRoot: "/repo", sink, logger })
    // then
    expect(lines[0]?.message).toBe("[mailbox-trace] routed")
    expect(lines[0]?.context).toMatchObject({ phase: "routed", lane: "subagent", messageId: "msg-1" })
  })

  it("truncates detail at 100 chars", async () => {
    // given
    const { records, sink } = collectingSink()
    const longDetail = "x".repeat(250)
    // when
    emitMailboxTrace(baseEvent({ phase: "lane-end", detail: longDetail }), { repoRoot: "/repo", sink })
    await Promise.resolve()
    // then
    expect((records[0]?.["detail"] as string).length).toBe(TRACE_DETAIL_PREVIEW_MAX)
  })

  it("relativizes a repoRoot-anchored path and redacts any other absolute path in detail", async () => {
    // given
    const { records, sink } = collectingSink()
    const repoRoot = "/Volumes/repo"
    // when
    emitMailboxTrace(
      baseEvent({ phase: "rolled-back", detail: `wrote /Volumes/repo/.omo/x.json and /etc/passwd` }),
      { repoRoot, sink },
    )
    await Promise.resolve()
    // then
    const detail = records[0]?.["detail"] as string
    expect(detail).not.toContain("/Volumes/repo/")
    expect(detail).not.toContain("/etc/passwd")
    expect(detail).toContain("[redacted-abs-path]")
  })

  it("omits absent optional fields instead of writing undefined keys", async () => {
    // given
    const { records, sink } = collectingSink()
    // when
    emitMailboxTrace(baseEvent({ phase: "received" }), { repoRoot: "/repo", sink })
    await Promise.resolve()
    // then
    const record = records[0] ?? {}
    expect("lane" in record).toBe(false)
    expect("requestedMode" in record).toBe(false)
    expect("detail" in record).toBe(false)
  })

  it("never throws when the sink throws synchronously", () => {
    // given
    const throwingSink: MailboxTraceSink = {
      append(): void {
        throw new Error("disk exploded")
      },
    }
    // when / then
    expect(() =>
      emitMailboxTrace(baseEvent(), { repoRoot: "/repo", sink: throwingSink, logger: () => {} }),
    ).not.toThrow()
  })

  it("never surfaces a rejected promise when the sink rejects asynchronously", async () => {
    // given
    let unhandled = false
    const onUnhandled = (): void => {
      unhandled = true
    }
    process.on("unhandledRejection", onUnhandled)
    const rejectingSink: MailboxTraceSink = {
      append(): Promise<void> {
        return Promise.reject(new Error("async disk failure"))
      },
    }
    // when
    emitMailboxTrace(baseEvent(), { repoRoot: "/repo", sink: rejectingSink, logger: () => {} })
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.removeListener("unhandledRejection", onUnhandled)
    // then
    expect(unhandled).toBe(false)
  })

  it("never throws when the logger itself throws", () => {
    // given
    const { sink } = collectingSink()
    const throwingLogger = (): void => {
      throw new Error("logger down")
    }
    // when / then
    expect(() =>
      emitMailboxTrace(baseEvent(), { repoRoot: "/repo", sink, logger: throwingLogger }),
    ).not.toThrow()
  })
})

describe("emitMailboxTrace seq", () => {
  it("assigns a strictly increasing seq across N events for one message", async () => {
    // given
    const { records, sink } = collectingSink()
    // when
    for (const phase of MAILBOX_TRACE_PHASES) {
      emitMailboxTrace(baseEvent({ phase }), { repoRoot: "/repo", sink, logger: () => {} })
    }
    await Promise.resolve()
    // then
    const seqs = records.map((record) => record["seq"] as number)
    for (let index = 1; index < seqs.length; index += 1) {
      expect((seqs[index] as number) > (seqs[index - 1] as number)).toBe(true)
    }
  })

  it("keeps seq globally increasing when two different messages interleave", async () => {
    // given
    const { records, sink } = collectingSink()
    // when
    emitMailboxTrace(baseEvent({ phase: "sent", messageId: "msg-a" }), { repoRoot: "/repo", sink, logger: () => {} })
    emitMailboxTrace(baseEvent({ phase: "sent", messageId: "msg-b" }), { repoRoot: "/repo", sink, logger: () => {} })
    emitMailboxTrace(baseEvent({ phase: "acked", messageId: "msg-a" }), { repoRoot: "/repo", sink, logger: () => {} })
    emitMailboxTrace(baseEvent({ phase: "acked", messageId: "msg-b" }), { repoRoot: "/repo", sink, logger: () => {} })
    await Promise.resolve()
    // then
    const seqs = records.map((record) => record["seq"] as number)
    for (let index = 1; index < seqs.length; index += 1) {
      expect((seqs[index] as number) > (seqs[index - 1] as number)).toBe(true)
    }
  })

  it("recovers true emit order when a shuffled record array is sorted by seq", async () => {
    // given
    const { records, sink } = collectingSink()
    const phases = [...MAILBOX_TRACE_PHASES]
    // when
    for (const phase of phases) {
      emitMailboxTrace(baseEvent({ phase }), { repoRoot: "/repo", sink, logger: () => {} })
    }
    await Promise.resolve()
    const shuffled = [...records].reverse()
    const recovered = [...shuffled].sort((left, right) => (left["seq"] as number) - (right["seq"] as number))
    // then
    expect(recovered.map((record) => record["phase"])).toEqual(phases)
  })
})
