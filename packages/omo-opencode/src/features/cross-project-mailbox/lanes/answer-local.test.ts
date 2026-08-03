import { describe, expect, it } from "bun:test"

import type { InternalPromptDispatchArgs, InternalPromptDispatchResult } from "../../../shared/prompt-async-gate"
import type { MailboxMessage } from "../envelope/schema"
import type { SendInput } from "../send-tool/envelope-builder"
import type { SendResult } from "../send-tool/project-message-tool"
import type { UnreadMessage } from "../mailbox/types"
import { createAnswerLocalLane } from "./answer-local"

const envelope: MailboxMessage = {
  version: 1,
  messageId: "11111111-1111-4111-8111-111111111111",
  timestamp: 1,
  correlationId: "22222222-2222-4222-8222-222222222222",
  inReplyToMessageId: null,
  fromProject: "Sender",
  toProject: "Receiver",
  fromProjectId: "sender-project",
  toProjectId: "receiver-project",
  intent: "question",
  priority: 3,
  hopCount: 0,
  hopPath: ["sender-project"],
  supersedes: null,
  requested_mode: "answer",
}

const note: UnreadMessage = {
  messageId: envelope.messageId,
  filePath: "/repo/coordination_notes/sender-project/.delivering-note.md",
  envelope,
  body: "What changed in the router?",
}

class FakeAnswerClient {
  readonly created: Array<{ readonly parentID: string; readonly directory: string }> = []

  readonly session = {
    create: async (input: {
      readonly body: { readonly parentID: string }
      readonly query: { readonly directory: string }
    }): Promise<{ readonly data: { readonly id: string }; readonly error?: string }> => {
      this.created.push({ parentID: input.body.parentID, directory: input.query.directory })
      return { data: { id: "child-session" } }
    },
    promptAsync: async (): Promise<unknown> => ({}),
  }
}

class FakeStore {
  readonly calls: string[] = []

  async ack(messageId: string): Promise<void> {
    this.calls.push(`ack:${messageId}`)
  }

  async unreserve(messageId: string): Promise<void> {
    this.calls.push(`unreserve:${messageId}`)
  }
}

function createHarness(overrides: {
  readonly dispatchResult?: InternalPromptDispatchResult
  readonly answerResult?: { readonly status: "completed"; readonly text: string } | { readonly status: "timeout" | "error"; readonly error?: string }
  readonly sendReply?: (input: SendInput) => Promise<SendResult>
} = {}) {
  const client = new FakeAnswerClient()
  const store = new FakeStore()
  const events: string[] = []
  const dispatches: InternalPromptDispatchArgs[] = []
  const sends: SendInput[] = []
  const logs: Array<{ readonly message: string; readonly context: unknown }> = []
  const dispatchInternalPrompt = async (
    args: InternalPromptDispatchArgs,
  ): Promise<InternalPromptDispatchResult> => {
    events.push("dispatch")
    dispatches.push(args)
    return overrides.dispatchResult ?? { status: "dispatched", response: {} }
  }
  const sendReply = overrides.sendReply ?? (async (input: SendInput): Promise<SendResult> => {
    events.push("send")
    sends.push(input)
    return {
      ok: true,
      envelope: { ...envelope, messageId: "33333333-3333-4333-8333-333333333333", inReplyToMessageId: note.messageId },
      messageId: "33333333-3333-4333-8333-333333333333",
      correlationId: envelope.correlationId,
    }
  })
  const lane = createAnswerLocalLane({
    client,
    directory: "/repo",
    dispatchInternalPrompt,
    log: (message, context) => logs.push({ message, context }),
    parentSessionId: "parent-session",
    sendReply,
    store,
    timeoutMs: 1234,
    waitForAnswer: async (sessionID, timeoutMs) => {
      events.push(`wait:${sessionID}:${timeoutMs}`)
      return overrides.answerResult ?? { status: "completed", text: "Router now routes answer-mode notes." }
    },
  })
  return { client, dispatches, events, lane, logs, sends, store }
}

describe("answer-local lane", () => {
  describe("#given an answer-mode note and a live parent session", () => {
    it("#then creates a child session with parentID and prompts the child through the gate", async () => {
      const { client, dispatches, lane } = createHarness()

      await lane.fulfill(note)

      expect(client.created).toEqual([{ parentID: "parent-session", directory: "/repo" }])
      expect(dispatches[0]?.sessionID).toBe("child-session")
      expect(dispatches[0]?.mode).toBe("async")
      expect(dispatches[0]?.queueBehavior).toBe("defer")
    })

    it("#then ack happens before the threaded answer reply is sent", async () => {
      const { events, lane, sends, store } = createHarness({
        sendReply: async (input) => {
          events.push("send")
          sends.push(input)
          return {
            ok: true,
            envelope: { ...envelope, messageId: "33333333-3333-4333-8333-333333333333", inReplyToMessageId: note.messageId },
            messageId: "33333333-3333-4333-8333-333333333333",
            correlationId: envelope.correlationId,
          }
        },
      })

      const result = await lane.fulfill(note)

      expect(result.status).toBe("replied")
      expect(store.calls).toEqual([`ack:${note.messageId}`])
      expect(events.indexOf("send")).toBeGreaterThan(-1)
      expect(events.indexOf("send")).toBeGreaterThan(store.calls.indexOf(`ack:${note.messageId}`))
      expect(sends[0]).toMatchObject({
        targetProjectId: "sender-project",
        intent: "question",
        body: "Router now routes answer-mode notes.",
        inReplyToMessageId: note.messageId,
      })
    })

    it("#then uses a designated answer host session when provided", async () => {
      const client = new FakeAnswerClient()
      const store = new FakeStore()
      const lane = createAnswerLocalLane({
        answerHostSessionId: "answer-host",
        client,
        directory: "/repo",
        dispatchInternalPrompt: async () => ({ status: "dispatched", response: {} }),
        parentSessionId: "parent-session",
        sendReply: async () => ({
          ok: true,
          envelope: { ...envelope, messageId: "33333333-3333-4333-8333-333333333333", inReplyToMessageId: note.messageId },
          messageId: "33333333-3333-4333-8333-333333333333",
          correlationId: envelope.correlationId,
        }),
        store,
        waitForAnswer: async () => ({ status: "completed", text: "answer" }),
      })

      await lane.fulfill(note)

      expect(client.created[0]?.parentID).toBe("answer-host")
    })
  })

  describe("#given the child session fails before ack", () => {
    it("#then unreserves the note and sends no reply", async () => {
      const { lane, sends, store } = createHarness({ answerResult: { status: "timeout", error: "too slow" } })

      const result = await lane.fulfill(note)

      expect(result).toEqual({ status: "rolled-back", downgradeReason: "child-session-failed" })
      expect(store.calls).toEqual([`unreserve:${note.messageId}`])
      expect(sends).toHaveLength(0)
    })

    it("#then rolls back when prompt delivery is rejected by the gate", async () => {
      const { lane, store } = createHarness({ dispatchResult: { status: "unavailable" } })

      const result = await lane.fulfill(note)

      expect(result.status).toBe("rolled-back")
      expect(store.calls).toEqual([`unreserve:${note.messageId}`])
    })
  })

  describe("#given reply send fails after ack", () => {
    it("#then logs and drops the answer without unreserving", async () => {
      const { lane, logs, store } = createHarness({
        sendReply: async () => ({ error: "reply-parent-not-found" }),
      })

      const result = await lane.fulfill(note)

      expect(result.status).toBe("answer-dropped")
      expect(store.calls).toEqual([`ack:${note.messageId}`])
      expect(store.calls.some((call) => call.startsWith("unreserve:"))).toBe(false)
      expect(logs.some((entry) => entry.message.includes("reply send failed after ack"))).toBe(true)
    })

    it("#then also drops the answer without unreserving when the send port throws", async () => {
      const { lane, logs, store } = createHarness({
        sendReply: async () => {
          throw new Error("network down")
        },
      })

      const result = await lane.fulfill(note)

      expect(result.status).toBe("answer-dropped")
      expect(store.calls).toEqual([`ack:${note.messageId}`])
      expect(store.calls.some((call) => call.startsWith("unreserve:"))).toBe(false)
      expect(logs.some((entry) => entry.message.includes("reply send failed after ack"))).toBe(true)
    })
  })
})
