import path from "node:path"

import type { UnreadMessage } from "../mailbox/types"

export type WorkerPrPaths = {
  readonly branchName: string
  readonly runRecordPath: string
  readonly workOrderPath: string
  readonly worktreePath: string
}

export type ResolveWorkerPrPathsInput = {
  readonly messageId: string
  readonly repoRoot: string
}

export type BuildWorkerPrWorkOrderInput = {
  readonly note: UnreadMessage
  readonly paths: WorkerPrPaths
}

export function shortWorkerPrId(messageId: string): string {
  return messageId.slice(0, 8)
}

export function resolveWorkerPrPaths(input: ResolveWorkerPrPathsInput): WorkerPrPaths {
  const shortId = shortWorkerPrId(input.messageId)
  return {
    branchName: `omo/mailbox/${shortId}`,
    runRecordPath: path.join(input.repoRoot, ".omo", "mailbox-work", "runs", `${input.messageId}.json`),
    workOrderPath: path.join(input.repoRoot, ".omo", "mailbox-work", `${input.messageId}.md`),
    worktreePath: path.join(input.repoRoot, ".local-ignore", "worktrees", `mailbox-${shortId}`),
  }
}

export function buildWorkerPrWorkOrder(input: BuildWorkerPrWorkOrderInput): string {
  const { note, paths } = input
  return `# Mailbox worker-pr work order

## Routing

- Original messageId: ${note.messageId}
- Sender project: ${note.envelope.fromProject} (${note.envelope.fromProjectId})
- Receiver project: ${note.envelope.toProject} (${note.envelope.toProjectId})
- Intent: ${note.envelope.intent}
- Worktree: ${paths.worktreePath}
- Branch: ${paths.branchName}

## Task

${note.body}

## Contract

1. Work only inside the dedicated worktree above. Do not edit the main checkout.
2. Read and follow the target repository policy files first, especially AGENTS.md and CONTRIBUTING.md. If the target repository has stricter PR, commit, evidence, or QA rules, follow that local policy.
3. Implement the requested change with tests first where possible. Run the repository's relevant QA/build/typecheck gates and record evidence paths.
4. Open a reviewer-readable PR unless the target repository policy explicitly forbids PR delivery. NEVER auto-merge, never push to protected branches, and never bypass review policy.
5. Reply to the sender with the PR URL, QA evidence, residual risk, and next human action. The main session will review, iterate, and merge when appropriate.
6. Because opencode run is internal/portless mode, reply with project_note, not project_message. Use targetProjectId "${note.envelope.fromProjectId}" and set inReplyToMessageId to "${note.messageId}".
7. After a successful project_note reply, write a small marker file at .omo/mailbox-work/replies/${note.messageId}.json so the watchdog can confirm the worker's own reply.

## Required reply shape

Include these machine-readable fields in the project_note body:

- status: success | failed
- PR URL: <url or policy-blocked explanation>
- evidence: <paths>
- next: review | iterate | merge
`
}
