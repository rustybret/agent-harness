import { describe, expect, it } from "bun:test"

import { MAILBOX_MODES } from "../envelope/schema"
import type { MailboxMessage, MailboxMode } from "../envelope/schema"
import {
  CLASSIFIER_CATEGORY,
  ClassificationCache,
  classifyNote,
  type ClassificationCacheFs,
} from "./classifier"

class MissingPathError extends Error {
  readonly code = "ENOENT"
}

class MemoryClassificationFs implements ClassificationCacheFs {
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
  const base = {
    messageId,
    fromProjectId: "sender",
    toProjectId: "receiver",
    intent: "impl",
    timestamp: 1,
  } satisfies MailboxMessage
  if (mode === undefined) return base
  return { ...base, requested_mode: mode }
}

function makeCache(now: () => number = () => 1): ClassificationCache {
  return new ClassificationCache({ fs: new MemoryClassificationFs(), now, repoRoot: "/repo", ttlMs: 60_000 })
}

describe("classifyNote", () => {
  it("#then exposes quick as the background classifier category", () => {
    // given
    // when
    // then
    expect(CLASSIFIER_CATEGORY).toBe("quick")
  })

  describe("#given a constrained response containing a mailbox mode", () => {
    it("#then returns the normalized classified mode", async () => {
      // given
      const note = { envelope: makeEnvelope("msg-valid"), body: "Please handle this." }

      // when
      const result = await classifyNote(note, {
        cache: makeCache(),
        classify: async () => " SubAgent\n",
      })

      // then
      expect(result).toEqual({ mode: "subagent" })
    })
  })

  describe("#given a constrained response containing triage", () => {
    it("#then returns the triage fallback without a failure reason", async () => {
      // given
      const note = { envelope: makeEnvelope("msg-triage"), body: "Please handle this." }

      // when
      const result = await classifyNote(note, {
        cache: makeCache(),
        classify: async () => "TRIAGE",
      })

      // then
      expect(result).toEqual({ mode: undefined })
    })
  })

  describe("#given a classifier response with extra text", () => {
    it("#then returns parse-failure instead of throwing", async () => {
      // given
      const note = { envelope: makeEnvelope("msg-garbage"), body: "Please handle this." }

      // when
      const result = await classifyNote(note, {
        cache: makeCache(),
        classify: async () => "subagent because it needs help",
      })

      // then
      expect(result).toEqual({ mode: undefined, reason: "parse-failure" })
    })
  })

  describe("#given the same message id was classified before", () => {
    it("#then returns the cached result without redispatching", async () => {
      // given
      const cache = makeCache()
      const note = { envelope: makeEnvelope("msg-cache"), body: "Please handle this." }
      let calls = 0
      const classify = async (): Promise<string> => {
        calls += 1
        return "answer"
      }

      // when
      const first = await classifyNote(note, { cache, classify })
      const second = await classifyNote(note, { cache, classify })

      // then
      expect(first).toEqual({ mode: "answer" })
      expect(second).toEqual({ mode: "answer" })
      expect(calls).toBe(1)
    })
  })

  describe("#given the classifier does not return before the timeout", () => {
    it("#then returns timeout instead of throwing", async () => {
      // given
      const note = { envelope: makeEnvelope("msg-timeout"), body: "Please handle this." }
      let calls = 0

      // when
      const result = await classifyNote(note, {
        cache: makeCache(),
        classify: () => {
          calls += 1
          return new Promise<string>(() => {})
        },
        timer: {
          clearTimeout,
          setTimeout: (callback) => {
            const handle = setTimeout(() => {}, 0)
            callback()
            return handle
          },
        },
        timeoutMs: 10,
      })

      // then
      expect(result).toEqual({ mode: undefined, reason: "timeout" })
      expect(calls).toBe(1)
    })
  })

  describe("#given the classifier dispatch rejects", () => {
    it("#then returns classifier-error instead of throwing", async () => {
      // given
      const note = { envelope: makeEnvelope("msg-error"), body: "Please handle this." }

      // when
      const result = await classifyNote(note, {
        cache: makeCache(),
        classify: async () => {
          throw new Error("dispatch failed")
        },
      })

      // then
      expect(result).toEqual({ mode: undefined, reason: "classifier-error" })
    })
  })

  describe("#given a caller accidentally passes a note with requested_mode", () => {
    it("#then refuses classification without dispatching", async () => {
      // given
      const note = { envelope: makeEnvelope("msg-has-mode", "answer"), body: "Please handle this." }
      let calls = 0

      // when
      const result = await classifyNote(note, {
        cache: makeCache(),
        classify: async () => {
          calls += 1
          return "subagent"
        },
      })

      // then
      expect(result).toEqual({ mode: undefined, reason: "parse-failure" })
      expect(calls).toBe(0)
    })
  })

  describe("#given every canonical mailbox mode", () => {
    it("#then accepts each exact mode token", async () => {
      // given
      const observed: MailboxMode[] = []

      for (const mode of MAILBOX_MODES) {
        // when
        const result = await classifyNote(
          { envelope: makeEnvelope(`msg-${mode}`), body: "Please handle this." },
          { cache: makeCache(), classify: async () => mode },
        )

        // then
        if (result.mode !== undefined) observed.push(result.mode)
      }

      expect(observed).toEqual([...MAILBOX_MODES])
    })
  })
})
