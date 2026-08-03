import { describe, expect, it } from "bun:test"

import type { MailboxMessage } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import { createWorkerPrLane, resolveWorkerPrDeadlineMs } from "./worker-pr"
import type { WorkerPrExecGit, WorkerPrSpawn } from "./worker-pr"

const envelope: MailboxMessage = {
  version: 1,
  messageId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  timestamp: 1_800_000_000_000,
  correlationId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  inReplyToMessageId: null,
  fromProject: "Sender",
  toProject: "Receiver",
  fromProjectId: "sender-project",
  toProjectId: "receiver-project",
  intent: "impl",
  priority: 3,
  hopCount: 0,
  hopPath: ["sender-project"],
  supersedes: null,
  requested_mode: "worker-pr",
}

const note: UnreadMessage = {
  messageId: envelope.messageId,
  filePath: "/repo/coordination_notes/sender-project/.delivering-note.md",
  envelope,
  body: "Implement mailbox worker PR lane.",
}

function createHarness() {
  const gitCalls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = []
  const spawns: Array<{ readonly command: readonly string[]; readonly cwd: string }> = []
  const workOrders: Array<{ readonly path: string; readonly content: string }> = []
  let unrefCount = 0
  const execGit: WorkerPrExecGit = async (args, options) => {
    gitCalls.push({ args, cwd: options.cwd })
  }
  const spawn: WorkerPrSpawn = (command, options) => {
    spawns.push({ command, cwd: options.cwd })
    return { pid: 42, unref: () => { unrefCount += 1 } }
  }
  const lane = createWorkerPrLane({
    execGit,
    now: () => 1_800_000_000_000,
    repoRoot: "/repo",
    spawn,
    wrapperPath: "/repo/packages/omo-opencode/src/features/cross-project-mailbox/lanes/worker-pr/run-worker.mjs",
    writeWorkOrder: async (path, content) => {
      workOrders.push({ path, content })
    },
  })
  return { gitCalls, lane, spawns, unrefCount: () => unrefCount, workOrders }
}

describe("worker-pr lane", () => {
  describe("#given a worker-pr-local routed note", () => {
    it("#then writes the work order, creates the dedicated worktree, spawns the wrapper, and returns immediately", async () => {
      // given
      const { gitCalls, lane, spawns, unrefCount, workOrders } = createHarness()

      // when
      const result = await lane.fulfill(note)

      // then
      expect(result).toEqual({
        branchName: "omo/mailbox/aaaaaaaa",
        status: "spawned",
        workOrderPath: "/repo/.omo/mailbox-work/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.md",
        worktreePath: "/repo/.local-ignore/worktrees/mailbox-aaaaaaaa",
      })
      expect(workOrders[0]?.path).toBe("/repo/.omo/mailbox-work/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.md")
      expect(gitCalls).toEqual([{ args: ["worktree", "add", "/repo/.local-ignore/worktrees/mailbox-aaaaaaaa", "-b", "omo/mailbox/aaaaaaaa"], cwd: "/repo" }])
      expect(spawns[0]?.cwd).toBe("/repo")
      expect(spawns[0]?.command).toEqual([
        "bun",
        "/repo/packages/omo-opencode/src/features/cross-project-mailbox/lanes/worker-pr/run-worker.mjs",
        "--worktree",
        "/repo/.local-ignore/worktrees/mailbox-aaaaaaaa",
        "--work-order",
        "/repo/.omo/mailbox-work/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.md",
        "--run-record",
        "/repo/.omo/mailbox-work/runs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json",
        "--deadline",
        "1800003600000",
      ])
      expect(unrefCount()).toBe(1)
    })

    it("#then resolves the worker deadline from minutes with a 60 minute default", () => {
      // given
      const now = 1_000

      // when
      const defaultDeadline = resolveWorkerPrDeadlineMs({ now })
      const envDeadline = resolveWorkerPrDeadlineMs({ now, envValue: "2" })

      // then
      expect(defaultDeadline).toBe(3_601_000)
      expect(envDeadline).toBe(121_000)
    })
  })
})
