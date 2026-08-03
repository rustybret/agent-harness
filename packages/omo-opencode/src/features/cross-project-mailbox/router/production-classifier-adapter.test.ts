import { describe, expect, it } from "bun:test"
import { createProductionClassifyNote } from "./production-classifier-adapter"
import type { MailboxMessage, MailboxMode } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import type { ClassifyNoteDeps } from "../hooks/route-note-dispatcher"
import type { RouteDecision } from "./types"
import type { ClassifierDeps } from "./classifier"
import { ClassificationCache } from "./classifier"

class MissingPathError extends Error {
  readonly code = "ENOENT"
}

class MemoryClassificationFs {
  private readonly files = new Map<string, string>()
  async mkdir(_dir: string): Promise<void> {}
  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(filePath)
    if (content === undefined) throw new MissingPathError(filePath)
    return content
  }
  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content)
  }
  async rename(from: string, to: string): Promise<void> {
    const content = await this.readFile(from)
    this.files.set(to, content)
    this.files.delete(from)
  }
  async rm(filePath: string): Promise<void> {
    this.files.delete(filePath)
  }
}

function makeEnvelope(messageId: string, mode?: MailboxMode): MailboxMessage {
  return {
    messageId,
    fromProjectId: "sender",
    toProjectId: "receiver",
    intent: "impl",
    timestamp: 1,
    requested_mode: mode,
  }
}

function makeCache(): ClassificationCache {
  return new ClassificationCache({
    fs: new MemoryClassificationFs(),
    now: () => 1,
    repoRoot: "/repo",
    ttlMs: 60_000,
  })
}

describe("createProductionClassifyNote", () => {
  describe("#given a valid classified mode within budget", () => {
    it("#then re-runs decideRoute and returns the correct lane and effectiveMode", async () => {
      // given
      const note: UnreadMessage = {
        messageId: "msg-1",
        filePath: "/repo/inbox/msg-1.json",
        envelope: makeEnvelope("msg-1"),
        body: "Please run a subagent task",
      }
      const classifierDeps: ClassifierDeps = {
        classify: async () => "subagent",
        cache: makeCache(),
      }
      const classifyNoteDeps: ClassifyNoteDeps = {
        senderConfig: {
          access: "allow",
          intent_budget: "impl",
        },
        routeContext: {
          presence: "none",
        },
      }

      // when
      const adapter = createProductionClassifyNote(classifierDeps)
      const result = await adapter(note, classifyNoteDeps)

      // then
      expect(result).toEqual({
        lane: "subagent",
        effectiveMode: "subagent",
      })
    })
  })

  describe("#given a classified mode that is over budget", () => {
    it("#then downgrades to triage with mode-over-budget reason", async () => {
      // given
      const note: UnreadMessage = {
        messageId: "msg-2",
        filePath: "/repo/inbox/msg-2.json",
        envelope: makeEnvelope("msg-2"),
        body: "Please run a subagent task",
      }
      const classifierDeps: ClassifierDeps = {
        classify: async () => "subagent",
        cache: makeCache(),
      }
      const classifyNoteDeps: ClassifyNoteDeps = {
        senderConfig: {
          access: "allow",
          intent_budget: "question", // subagent is over budget for question
        },
        routeContext: {
          presence: "none",
        },
      }

      // when
      const adapter = createProductionClassifyNote(classifierDeps)
      const result = await adapter(note, classifyNoteDeps)

      // then
      expect(result).toEqual({
        lane: "triage",
        downgradeReason: "mode-over-budget",
      })
    })
  })

  describe("#given a classifier failure or garbage response", () => {
    it("#then falls back to triage with the failure reason", async () => {
      // given
      const note: UnreadMessage = {
        messageId: "msg-3",
        filePath: "/repo/inbox/msg-3.json",
        envelope: makeEnvelope("msg-3"),
        body: "Please run a subagent task",
      }
      const classifierDeps: ClassifierDeps = {
        classify: async () => "garbage-response",
        cache: makeCache(),
      }
      const classifyNoteDeps: ClassifyNoteDeps = {
        senderConfig: {
          access: "allow",
          intent_budget: "impl",
        },
        routeContext: {
          presence: "none",
        },
      }

      // when
      const adapter = createProductionClassifyNote(classifierDeps)
      const result = await adapter(note, classifyNoteDeps)

      // then
      expect(result).toEqual({
        lane: "triage",
        downgradeReason: "parse-failure",
      })
    })
  })

  describe("#given the classifier throws an error", () => {
    it("#then gracefully falls back to triage with classifier-error", async () => {
      // given
      const note: UnreadMessage = {
        messageId: "msg-4",
        filePath: "/repo/inbox/msg-4.json",
        envelope: makeEnvelope("msg-4"),
        body: "Please run a subagent task",
      }
      const classifierDeps: ClassifierDeps = {
        classify: async () => {
          throw new Error("network error")
        },
        cache: makeCache(),
      }
      const classifyNoteDeps: ClassifyNoteDeps = {
        senderConfig: {
          access: "allow",
          intent_budget: "impl",
        },
        routeContext: {
          presence: "none",
        },
      }

      // when
      const adapter = createProductionClassifyNote(classifierDeps)
      const result = await adapter(note, classifyNoteDeps)

      // then
      expect(result).toEqual({
        lane: "triage",
        downgradeReason: "classifier-error",
      })
    })
  })
})
