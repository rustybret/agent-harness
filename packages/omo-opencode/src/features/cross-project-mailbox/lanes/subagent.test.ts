import { describe, expect, it } from "bun:test"

import { CATEGORY_TIER } from "../permission-tiers"
import type { CanonicalIntent } from "../permission-tiers"
import type { MailboxMessage } from "../envelope/schema"
import { isPlanFamily } from "../../../tools/delegate-task/constants"
import {
  INVESTIGATE_THEN_IMPLEMENT_MARKER,
  resolveDispatchCategory,
  runSubagentLane,
} from "./subagent"
import type {
  SubagentLaneDeps,
  SubagentLaneNote,
  SubagentLaneResult,
  SubagentReplySummary,
  SubagentSpawnInput,
  TaskWaitResult,
} from "./subagent"

const CEILINGS: readonly CanonicalIntent[] = ["question", "impl", "plan"]
const CATEGORY_TIER_ORACLE: Record<string, CanonicalIntent> = {
  quick: "impl",
  "unspecified-low": "impl",
  deep: "plan",
  ultrabrain: "plan",
  "unspecified-high": "plan",
  "visual-engineering": "plan",
  artistry: "plan",
  writing: "plan",
}
const RANK: Record<CanonicalIntent, number> = { question: 0, impl: 1, plan: 2 }

function assertNever(value: never): never {
  throw new Error(`unhandled test value: ${value}`)
}

function expectedCategory(category: string, ceiling: CanonicalIntent): { readonly category: string } | { readonly downgrade: true } {
  if (RANK[CATEGORY_TIER_ORACLE[category] ?? "plan"] <= RANK[ceiling] && !isPlanFamily(category)) {
    return { category }
  }
  if (RANK.impl <= RANK[ceiling]) {
    return { category: "quick" }
  }
  return { downgrade: true }
}

function makeEnvelope(input: {
  readonly messageId?: string
  readonly intent?: MailboxMessage["intent"]
  readonly body?: string
  readonly category?: string
} = {}): MailboxMessage {
  return {
    version: 1,
    messageId: input.messageId ?? "10000000-0000-4000-8000-000000000001",
    timestamp: 1,
    correlationId: "20000000-0000-4000-8000-000000000002",
    inReplyToMessageId: null,
    fromProject: "Sender",
    toProject: "Receiver",
    fromProjectId: "sender-project",
    toProjectId: "receiver-project",
    intent: input.intent ?? "quick",
    ...(input.category === undefined ? {} : { category: input.category }),
    priority: 0,
    hopCount: 0,
    hopPath: ["sender-project"],
    supersedes: null,
    requested_mode: "subagent",
  }
}

function makeNote(input: {
  readonly messageId?: string
  readonly intent?: MailboxMessage["intent"]
  readonly body?: string
  readonly category?: string
} = {}): SubagentLaneNote {
  return {
    envelope: makeEnvelope(input),
    body: input.body ?? "Update the mailbox lane implementation.",
  }
}

function assertDispatched(result: SubagentLaneResult): Extract<SubagentLaneResult, { readonly status: "dispatched" }> {
  if (result.status !== "dispatched") {
    throw new Error(`expected dispatched result, got ${result.status}`)
  }
  return result
}

function createHarness(input: {
  readonly note?: SubagentLaneNote
  readonly ceiling?: CanonicalIntent
  readonly waitResults?: Record<string, TaskWaitResult>
} = {}) {
  const note = input.note ?? makeNote()
  const spawns: SubagentSpawnInput[] = []
  const waits: string[] = []
  const acks: string[] = []
  const replies: SubagentReplySummary[] = []
  const events: string[] = []
  const deps: SubagentLaneDeps = {
    parentMessageId: "parent-message",
    parentSessionId: "parent-session",
    senderCeiling: input.ceiling ?? "impl",
    ack: async (messageId) => {
      events.push(`ack:${messageId}`)
      acks.push(messageId)
    },
    sendReply: async (_note, summary) => {
      events.push(`reply:${summary.status}`)
      replies.push(summary)
    },
    spawn: async (spawnInput) => {
      events.push(`spawn:${spawnInput.agent}`)
      spawns.push(spawnInput)
      return { taskId: `task-${spawns.length}` }
    },
    waitForTask: async (taskId) => {
      events.push(`wait:${taskId}`)
      waits.push(taskId)
      return input.waitResults?.[taskId] ?? { status: "completed", result: "Done. Evidence: .omo/evidence/task-8.md" }
    },
  }
  return { acks, deps, events, note, replies, spawns, waits }
}

describe("resolveDispatchCategory", () => {
  describe("#given default category mapping from note intent", () => {
    it("#then keeps quick intent on quick and impl intent on unspecified-high when budget allows", () => {
      // given / when / then
      expect(resolveDispatchCategory(makeNote({ intent: "quick" }), "impl")).toEqual({ category: "quick" })
      expect(resolveDispatchCategory(makeNote({ intent: "impl" }), "plan")).toEqual({ category: "unspecified-high" })
    })

    it("#then maps review, work-loop, plan, and question without resolving a plan-family category", () => {
      // given
      const notes = [
        makeNote({ intent: "review" }),
        makeNote({ intent: "work-loop" }),
        makeNote({ intent: "plan" }),
        makeNote({ intent: "question" }),
      ]

      for (const note of notes) {
        // when
        const result = resolveDispatchCategory(note, "plan")

        // then
        expect("category" in result).toBe(true)
        if ("category" in result) {
          expect(isPlanFamily(result.category)).toBe(false)
        }
      }
    })
  })

  describe("#given explicit category cells across sender ceilings", () => {
    it("#then keeps within-budget categories and downgrades over-budget categories to the safest acceptable category", () => {
      // given
      let covered = 0

      for (const category of Object.keys(CATEGORY_TIER_ORACLE)) {
        for (const ceiling of CEILINGS) {
          const note = makeNote({ category })
          const expected = expectedCategory(category, ceiling)

          // when
          const result = resolveDispatchCategory(note, ceiling)

          // then
          if ("downgrade" in expected) {
            expect(result).toMatchObject({ downgrade: true })
          } else {
            expect(result).toEqual(expected)
          }
          covered += 1
        }
      }

      expect(covered).toBe(Object.keys(CATEGORY_TIER).length * CEILINGS.length)
    })

    it("#then signals downgrade-to-triage when no category fits a question ceiling", () => {
      // given
      const note = makeNote({ category: "deep" })

      // when
      const result = resolveDispatchCategory(note, "question")

      // then
      expect(result).toEqual({ downgrade: true, reason: "category-over-budget" })
    })

    it("#then never returns explicit plan-family category names", () => {
      // given
      const planFamily = ["plan", "prometheus"] as const

      for (const category of planFamily) {
        // when
        const result = resolveDispatchCategory(makeNote({ category }), "plan")

        // then
        expect(result).toEqual({ category: "quick" })
      }
    })
  })
})

describe("runSubagentLane", () => {
  describe("#given a subagent note without the split marker", () => {
    it("#then dispatches one implementation subagent, acks at dispatch time, and replies on completion", async () => {
      // given
      const { acks, deps, events, note, replies, spawns, waits } = createHarness()

      // when
      const result = assertDispatched(await runSubagentLane(note, deps))
      await result.completion

      // then
      expect(spawns).toHaveLength(1)
      expect(spawns[0]).toMatchObject({
        agent: "sisyphus-junior",
        category: "quick",
        parentMessageId: "parent-message",
        parentSessionId: "parent-session",
      })
      expect(acks).toEqual([note.envelope.messageId])
      expect(waits).toEqual(["task-1"])
      expect(replies).toEqual([
        {
          status: "completed",
          category: "quick",
          taskIds: ["task-1"],
          resultSummary: "Done. Evidence: .omo/evidence/task-8.md",
          evidencePath: ".omo/evidence/task-8.md",
        },
      ])
      expect(events.indexOf(`ack:${note.envelope.messageId}`)).toBeLessThan(events.indexOf("wait:task-1"))
    })

    it("#then sends a threaded failure summary when the task fails after dispatch", async () => {
      // given
      const { deps, note, replies } = createHarness({
        waitResults: { "task-1": { status: "failed", result: "model exhausted" } },
      })

      // when
      const result = assertDispatched(await runSubagentLane(note, deps))
      await result.completion

      // then
      expect(replies).toEqual([
        {
          status: "failed",
          category: "quick",
          taskIds: ["task-1"],
          errorSummary: "model exhausted",
        },
      ])
    })
  })

  describe("#given an impl note with only impl budget", () => {
    it("#then downgrades the default unspecified-high category before dispatch", async () => {
      // given
      const note = makeNote({ intent: "impl" })
      const { deps, spawns } = createHarness({ note, ceiling: "impl" })

      // when
      const result = assertDispatched(await runSubagentLane(note, deps))
      await result.completion

      // then
      expect(spawns[0]?.category).toBe("quick")
    })
  })

  describe("#given no dispatch category fits the sender ceiling", () => {
    it("#then returns a downgrade signal and does not ack or spawn", async () => {
      // given
      const note = makeNote({ category: "deep" })
      const { acks, deps, spawns } = createHarness({ note, ceiling: "question" })

      // when
      const result = await runSubagentLane(note, deps)

      // then
      expect(result).toEqual({ status: "downgraded", reason: "category-over-budget" })
      expect(spawns).toHaveLength(0)
      expect(acks).toHaveLength(0)
    })
  })

  describe("#given a note with the explicit investigate then implement marker", () => {
    it("#then dispatches explore first and appends its findings to the implementation prompt", async () => {
      // given
      const note = makeNote({ body: `Audit mailbox routing. ${INVESTIGATE_THEN_IMPLEMENT_MARKER}` })
      const { deps, replies, spawns, waits } = createHarness({
        note,
        waitResults: {
          "task-1": { status: "completed", result: "finding-alpha" },
          "task-2": { status: "completed", result: "implementation complete" },
        },
      })

      // when
      const result = assertDispatched(await runSubagentLane(note, deps))
      await result.completion

      // then
      expect(spawns.map((spawn) => spawn.agent)).toEqual(["explore", "sisyphus-junior"])
      expect(spawns.map((spawn) => spawn.category)).toEqual(["quick", "quick"])
      expect(spawns[1]?.prompt).toContain("finding-alpha")
      expect(waits).toEqual(["task-1", "task-2"])
      expect(replies[0]).toMatchObject({ status: "completed", taskIds: ["task-1", "task-2"] })
    })

    it("#then sends a failure reply and skips implementation when investigation fails", async () => {
      // given
      const note = makeNote({ body: `Audit mailbox routing. ${INVESTIGATE_THEN_IMPLEMENT_MARKER}` })
      const { deps, replies, spawns } = createHarness({
        note,
        waitResults: { "task-1": { status: "failed", result: "investigation failed" } },
      })

      // when
      const result = assertDispatched(await runSubagentLane(note, deps))
      await result.completion

      // then
      expect(spawns.map((spawn) => spawn.agent)).toEqual(["explore"])
      expect(replies).toEqual([
        {
          status: "failed",
          category: "quick",
          taskIds: ["task-1"],
          errorSummary: "investigation failed",
        },
      ])
    })
  })
})
