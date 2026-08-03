import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { safeMessageIdFilename } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/envelope/path-guard"
import { serializeEnvelope, type MailboxMessage } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema"
import { ARBITER_PROJECT_ID, type RelayPayload, type RelaySandbox, type RelaySeed } from "./types"

export function buildSeedPayload(sandbox: RelaySandbox): RelayPayload {
  return {
    version: 1,
    sentenceNumbers: sandbox.sentenceNumbers,
    arbiterDropDir: sandbox.arbiterDropDir,
    finalFile: "final.json",
    chain: sandbox.projects.map((project, index) => ({
      projectId: project.projectId,
      requestedMode: sandbox.hops[index]?.requestedMode,
    })),
    knownWords: {},
  }
}

export async function seedArbiterEnvelope(sandbox: RelaySandbox): Promise<RelaySeed> {
  const firstProject = sandbox.projects[0]
  if (firstProject === undefined) {
    throw new Error("relay sandbox has no first project")
  }
  const messageId = randomUUID()
  const correlationId = randomUUID()
  const envelope: MailboxMessage = {
    version: 1,
    messageId,
    timestamp: Date.now(),
    correlationId,
    inReplyToMessageId: null,
    fromProject: "cipher-relay-arbiter",
    toProject: firstProject.displayName,
    fromProjectId: ARBITER_PROJECT_ID,
    toProjectId: firstProject.projectId,
    intent: "impl",
    category: "quick",
    priority: 1,
    hopCount: 0,
    hopPath: [ARBITER_PROJECT_ID],
    supersedes: null,
    requested_mode: firstProject.index === 0 ? sandbox.hops[0]?.requestedMode : undefined,
  }
  const body = buildSeedPayload(sandbox)
  const inbox = path.join(firstProject.root, "coordination_notes", ARBITER_PROJECT_ID)
  await mkdir(inbox, { recursive: true, mode: 0o700 })
  const filePath = path.join(inbox, safeMessageIdFilename(messageId))
  await writeFile(filePath, serializeEnvelope(envelope, JSON.stringify(body, null, 2)))
  return { messageId, correlationId, filePath, body }
}
