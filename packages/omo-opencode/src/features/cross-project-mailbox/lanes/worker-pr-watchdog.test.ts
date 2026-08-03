import { describe, expect, it } from "bun:test"

import { runWorkerPrWatchdogTick } from "./worker-pr-watchdog"
import type { WorkerPrWatchdogDeps, WorkerPrRunRecordEntry } from "./worker-pr-watchdog"

function entry(messageId: string, record: WorkerPrRunRecordEntry["record"]): WorkerPrRunRecordEntry {
  return { messageId, record }
}

function createHarness(records: readonly WorkerPrRunRecordEntry[], now = 2_000) {
  const gitCalls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = []
  const replies: Array<{ readonly messageId: string; readonly body: string }> = []
  const writes: WorkerPrRunRecordEntry[] = []
  const logs: Array<{ readonly message: string; readonly context?: Record<string, unknown> }> = []
  const deps: WorkerPrWatchdogDeps = {
    checkWorkerReplyExists: async (messageId) => messageId === "success-replied",
    execGit: async (args, options) => {
      gitCalls.push({ args, cwd: options.cwd })
    },
    log: (message, context) => {
      logs.push({ message, context })
    },
    now: () => now,
    readRunRecords: async () => records,
    repoRoot: "/repo",
    sendFallbackReply: async (messageId, body) => {
      replies.push({ messageId, body })
    },
    writeRunRecord: async (messageId, record) => {
      writes.push({ messageId, record })
    },
  }
  return { deps, gitCalls, logs, replies, writes }
}

describe("worker-pr watchdog", () => {
  describe("#given a worker exited zero and its own project_note reply exists", () => {
    it("#then prunes the successful worktree without sending a fallback reply", async () => {
      // given
      const records = [entry("success-replied", { pid: 42, startedAt: 1_000, deadline: 10_000, exitCode: 0, finishedAt: 1_500 })]
      const { deps, gitCalls, replies } = createHarness(records)

      // when
      await runWorkerPrWatchdogTick(deps)

      // then
      expect(replies).toEqual([])
      expect(gitCalls).toEqual([{ args: ["worktree", "remove", "/repo/.local-ignore/worktrees/mailbox-success-"], cwd: "/repo" }])
    })
  })

  describe("#given a worker exited zero but its own reply is missing", () => {
    it("#then sends a success-with-warning fallback reply before pruning", async () => {
      // given
      const records = [entry("success-missing", { pid: 42, startedAt: 1_000, deadline: 10_000, exitCode: 0, finishedAt: 1_500 })]
      const { deps, gitCalls, replies } = createHarness(records)

      // when
      await runWorkerPrWatchdogTick(deps)

      // then
      expect(replies[0]?.messageId).toBe("success-missing")
      expect(replies[0]?.body).toContain("success-with-warning")
      expect(gitCalls).toEqual([{ args: ["worktree", "remove", "/repo/.local-ignore/worktrees/mailbox-success-"], cwd: "/repo" }])
    })
  })

  describe("#given a worker exits nonzero", () => {
    it("#then sends a failure fallback reply and preserves the failed worktree", async () => {
      // given
      const records = [entry("failed-01", { pid: 42, startedAt: 1_000, deadline: 10_000, exitCode: 7, finishedAt: 1_500 })]
      const { deps, gitCalls, replies, writes } = createHarness(records)

      // when
      await runWorkerPrWatchdogTick(deps)

      // then
      expect(replies).toEqual([{ messageId: "failed-01", body: expect.stringContaining("exitCode: 7") }])
      expect(writes).toEqual([entry("failed-01", { pid: 42, startedAt: 1_000, deadline: 10_000, exitCode: 7, finishedAt: 1_500 })])
      expect(gitCalls).toEqual([])
    })
  })

  describe("#given a worker exceeds its deadline and failed worktrees exceed the cap", () => {
    it("#then marks it failed, sends a failure reply, keeps the current worktree, and prunes oldest failed worktrees first", async () => {
      // given
      const records = [
        entry("oldest-01", { pid: 1, startedAt: 100, deadline: 200, exitCode: 1, finishedAt: 300 }),
        entry("oldest-02", { pid: 2, startedAt: 200, deadline: 300, exitCode: 1, finishedAt: 400 }),
        entry("kept-03", { pid: 3, startedAt: 300, deadline: 400, exitCode: 1, finishedAt: 500 }),
        entry("kept-04", { pid: 4, startedAt: 400, deadline: 500, exitCode: 1, finishedAt: 600 }),
        entry("kept-05", { pid: 5, startedAt: 500, deadline: 600, exitCode: 1, finishedAt: 700 }),
        entry("deadline-06", { pid: 6, startedAt: 600, deadline: 1_000 }),
      ]
      const { deps, gitCalls, logs, replies, writes } = createHarness(records, 2_000)

      // when
      await runWorkerPrWatchdogTick(deps)

      // then
      const deadlineReply = replies.find((reply) => reply.messageId === "deadline-06")
      expect(deadlineReply?.body).toContain("failed")
      expect(writes).toContainEqual(entry("deadline-06", { pid: 6, startedAt: 600, deadline: 1_000, exitCode: -1, finishedAt: 2_000 }))
      expect(gitCalls).toEqual([
        { args: ["worktree", "remove", "/repo/.local-ignore/worktrees/mailbox-oldest-0"], cwd: "/repo" },
      ])
      expect(logs.some((log) => log.message.includes("pruned failed worker-pr worktree"))).toBe(true)
    })
  })
})
