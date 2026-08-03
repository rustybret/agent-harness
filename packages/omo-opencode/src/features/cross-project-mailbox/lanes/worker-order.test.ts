import { describe, expect, it } from "bun:test"

import type { MailboxMessage } from "../envelope/schema"
import type { UnreadMessage } from "../mailbox/types"
import { buildWorkerPrWorkOrder, resolveWorkerPrPaths, shortWorkerPrId } from "./worker-order"

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
  body: "Implement mailbox worker PR lane and prove it with tests.",
}

describe("worker-pr work order", () => {
  describe("#given a worker-pr mailbox note", () => {
    it("#then derives the task-owned paths and branch from the message short id", () => {
      // given
      const repoRoot = "/repo"

      // when
      const paths = resolveWorkerPrPaths({ messageId: note.messageId, repoRoot })

      // then
      expect(shortWorkerPrId(note.messageId)).toBe("aaaaaaaa")
      expect(paths).toEqual({
        branchName: "omo/mailbox/aaaaaaaa",
        runRecordPath: "/repo/.omo/mailbox-work/runs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json",
        workOrderPath: "/repo/.omo/mailbox-work/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.md",
        worktreePath: "/repo/.local-ignore/worktrees/mailbox-aaaaaaaa",
      })
    })

    it("#then builds a worker contract with reply routing and repo-policy guardrails", () => {
      // given
      const paths = resolveWorkerPrPaths({ messageId: note.messageId, repoRoot: "/repo" })

      // when
      const content = buildWorkerPrWorkOrder({ note, paths })

      // then
      expect(content).toContain("project_note")
      expect(content).toContain("inReplyToMessageId")
      expect(content).toContain(note.messageId)
      expect(content).toContain(note.body)
      expect(content).toContain("PR URL")
      expect(content).toContain("AGENTS.md")
      expect(content).toContain("CONTRIBUTING.md")
      expect(content).toContain(paths.worktreePath)
      expect(content).toContain("NEVER auto-merge")
    })
  })
})
