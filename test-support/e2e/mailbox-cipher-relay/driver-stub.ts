import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { safeMessageIdFilename } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/envelope/path-guard"
import { parseEnvelope, serializeEnvelope, type MailboxMessage } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema"
import { readCipherWords } from "./cipher-fixture"
import type { RelayFinalDrop, RelayHopReport, RelayPayload, RelayProject, RelaySandbox, RelaySeed } from "./types"

export interface RelayAgentDriver {
  readonly description: string
  start(sandbox: RelaySandbox): Promise<void>
  stop(): Promise<void>
}

function parsePayload(body: string): RelayPayload {
  const parsed: unknown = JSON.parse(body)
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("relay payload must be a JSON object")
  }
  const record = parsed as RelayPayload
  if (record.version !== 1 || !Array.isArray(record.sentenceNumbers) || !Array.isArray(record.chain)) {
    throw new Error("relay payload is not v1")
  }
  return record
}

function projectOwnsNumber(project: RelayProject, value: number): boolean {
  return value >= project.index * 10 && value <= project.index * 10 + 9
}

async function substituteProjectWords(project: RelayProject, payload: RelayPayload): Promise<{
  readonly payload: RelayPayload
  readonly report: RelayHopReport
}> {
  const words = await readCipherWords(project.wordsPath)
  const knownWords = { ...(payload.knownWords ?? {}) }
  const substituted: number[] = []
  for (const number of payload.sentenceNumbers) {
    if (!projectOwnsNumber(project, number)) continue
    const word = words[String(number)]
    if (word === undefined) {
      throw new Error(`project ${project.projectId} missing word for ${number}`)
    }
    knownWords[String(number)] = word
    substituted.push(number)
  }
  return {
    payload: { ...payload, knownWords },
    report: {
      projectId: project.projectId,
      substituted,
      requestedMode: payload.chain[project.index]?.requestedMode,
    },
  }
}

async function writeForwardedEnvelope(input: {
  readonly sandbox: RelaySandbox
  readonly from: RelayProject
  readonly to: RelayProject
  readonly previous: MailboxMessage
  readonly payload: RelayPayload
}): Promise<string> {
  const messageId = randomUUID()
  const envelope: MailboxMessage = {
    version: 1,
    messageId,
    timestamp: Date.now(),
    correlationId: input.previous.correlationId,
    inReplyToMessageId: input.previous.messageId,
    fromProject: input.from.displayName,
    toProject: input.to.displayName,
    fromProjectId: input.from.projectId,
    toProjectId: input.to.projectId,
    intent: "impl",
    category: "quick",
    priority: 1,
    hopCount: input.previous.hopCount + 1,
    hopPath: [...input.previous.hopPath, input.from.projectId],
    supersedes: null,
    requested_mode: input.sandbox.hops[input.from.index]?.requestedMode,
  }
  const inbox = path.join(input.to.root, "coordination_notes", input.from.projectId)
  await mkdir(inbox, { recursive: true, mode: 0o700 })
  const target = path.join(inbox, safeMessageIdFilename(messageId))
  await writeFile(target, serializeEnvelope(envelope, JSON.stringify(input.payload, null, 2)))
  return target
}

async function writeFinalDrop(sandbox: RelaySandbox, payload: RelayPayload, hops: readonly RelayHopReport[]): Promise<string> {
  const knownWords = payload.knownWords ?? {}
  const sentence = payload.sentenceNumbers.map((number) => {
    const word = knownWords[String(number)]
    if (word === undefined) {
      throw new Error(`final payload missing word for ${number}`)
    }
    return word
  }).join(" ")
  const finalDrop: RelayFinalDrop = { sentence, hops }
  const finalPath = path.join(sandbox.arbiterDropDir, payload.finalFile)
  await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 })
  await writeFile(finalPath, `${JSON.stringify(finalDrop, null, 2)}\n`)
  return finalPath
}

export async function simulateRelayProgrammatically(sandbox: RelaySandbox, seed: RelaySeed): Promise<string> {
  let currentPath = seed.filePath
  const reports: RelayHopReport[] = []
  let currentEnvelope: MailboxMessage | undefined
  let currentPayload: RelayPayload | undefined

  for (const project of sandbox.projects) {
    const parsed = parseEnvelope(await readFile(currentPath, "utf8"))
    currentEnvelope = parsed.envelope
    const substituted = await substituteProjectWords(project, parsePayload(parsed.body))
    currentPayload = substituted.payload
    reports.push(substituted.report)
    const next = sandbox.projects[project.index + 1]
    if (next !== undefined) {
      currentPath = await writeForwardedEnvelope({
        sandbox,
        from: project,
        to: next,
        previous: currentEnvelope,
        payload: currentPayload,
      })
    }
  }

  if (currentPayload === undefined) {
    throw new Error("relay produced no payload")
  }
  return await writeFinalDrop(sandbox, currentPayload, reports)
}

export async function writeWrongFinalDrop(sandbox: RelaySandbox): Promise<string> {
  const finalDrop: RelayFinalDrop = {
    sentence: `${sandbox.expectedSentence} wrong`,
    hops: [],
  }
  const finalPath = path.join(sandbox.arbiterDropDir, "final.json")
  await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 })
  await writeFile(finalPath, `${JSON.stringify(finalDrop, null, 2)}\n`)
  return finalPath
}

export async function writeDriverManifest(sandbox: RelaySandbox): Promise<string> {
  const manifestPath = path.join(sandbox.root, "driver-manifest.json")
  const manifest = {
    opencodeServe: sandbox.projects.map((project) => ({
      projectId: project.projectId,
      cwd: project.root,
      command: project.serveCommand,
      env: project.env,
      presence: `mode=external at ${path.join(sandbox.home, ".omo", "presence", `${project.projectId}.json`)}`,
    })),
    seed: "Call seedArbiterEnvelope(sandbox), then start live agent sessions against the serve URLs.",
    finalDrop: sandbox.arbiterDropDir,
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifestPath
}
