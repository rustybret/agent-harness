/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import type { InternalPromptDispatchArgs, InternalPromptDispatchResult } from "../../shared/prompt-async-gate"
import { EXTERNAL_INJECT_SOURCE, createInjectAdapter } from "./inject-adapter"

interface Captured {
  args: InternalPromptDispatchArgs | undefined
}

function makeAdapter(
  result: InternalPromptDispatchResult,
  captured: Captured = { args: undefined },
) {
  const dispatchInternalPrompt = async (
    args: InternalPromptDispatchArgs,
  ): Promise<InternalPromptDispatchResult> => {
    captured.args = args
    return result
  }
  const adapter = createInjectAdapter({
    client: { session: { promptAsync: async () => ({}) } },
    directory: "/repo/root",
    dispatchInternalPrompt,
  })
  return { adapter, captured }
}

describe("external-inject inject-adapter", () => {
  describe("#given the gate accepts the dispatch", () => {
    it("#then maps dispatched -> 202 accepted", async () => {
      const { adapter } = makeAdapter({ status: "dispatched", response: {} })
      const res = await adapter.inject("ses_a", "compile error")
      expect(res.status).toBe(202)
    })

    it("#then maps queued -> 202 accepted", async () => {
      const { adapter } = makeAdapter({ status: "queued", queuedBy: "x", position: 1 })
      const res = await adapter.inject("ses_a", "compile error")
      expect(res.status).toBe(202)
    })
  })

  describe("#given the gate rejects the dispatch", () => {
    it("#then maps unavailable -> 503", async () => {
      const { adapter } = makeAdapter({ status: "unavailable" })
      const res = await adapter.inject("ses_a", "x")
      expect(res.status).toBe(503)
    })

    it("#then maps reserved -> 429", async () => {
      const { adapter } = makeAdapter({ status: "reserved", reservedBy: "other" })
      const res = await adapter.inject("ses_a", "x")
      expect(res.status).toBe(429)
    })

    it("#then maps failed -> 503", async () => {
      const { adapter } = makeAdapter({ status: "failed", error: new Error("boom"), dispatchAttempted: true })
      const res = await adapter.inject("ses_a", "x")
      expect(res.status).toBe(503)
    })
  })

  describe("#given a dispatch", () => {
    it("#then routes through the gate with async mode, defer, and the inject source", async () => {
      const { adapter, captured } = makeAdapter({ status: "dispatched", response: {} })
      await adapter.inject("ses_target", "hello unity")
      const args = captured.args
      expect(args?.mode).toBe("async")
      expect(args?.source).toBe(EXTERNAL_INJECT_SOURCE)
      expect(args?.sessionID).toBe("ses_target")
      expect(args?.queueBehavior).toBe("defer")
    })

    it("#then builds the standard session-prompt input shape with the text part", async () => {
      const { adapter, captured } = makeAdapter({ status: "dispatched", response: {} })
      await adapter.inject("ses_target", "hello unity")
      const input = captured.args?.input as {
        path: { id: string }
        body: { parts: Array<{ type: string; text: string }> }
        query: { directory: string }
      }
      expect(input.path.id).toBe("ses_target")
      expect(input.body.parts[0]).toEqual({ type: "text", text: "hello unity" })
      expect(input.query.directory).toBe("/repo/root")
    })

    it("#then sets a stable coalesce dedupeKey for identical text", async () => {
      const { adapter, captured } = makeAdapter({ status: "dispatched", response: {} })
      await adapter.inject("ses_target", "same text")
      const first = captured.args?.dedupeKey
      await adapter.inject("ses_target", "same text")
      const second = captured.args?.dedupeKey
      expect(first).toBe(second)
      expect(typeof first).toBe("string")
    })
  })
})
