import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import type { PresenceRecord } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/presence/presence-record"
import { presenceRecordPath } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/presence/presence-record"
import type { RelayProject, RelaySandbox } from "./types"

export async function writeSelfTestExternalPresence(sandbox: RelaySandbox): Promise<void> {
  for (const project of sandbox.projects) {
    const record: PresenceRecord = {
      projectId: project.projectId,
      repoRoot: project.root,
      mode: "external",
      serverUrl: `http://127.0.0.1:${project.port}`,
      sessionId: `self-test-${project.name}`,
      pid: process.pid,
      heartbeatTs: Date.now(),
    }
    const filePath = presenceRecordPath(project.projectId, sandbox.home)
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  }
}

export async function assertExternalMode(sandbox: RelaySandbox): Promise<void> {
  for (const project of sandbox.projects) {
    await assertProjectExternalMode(project, sandbox.home)
  }
}

export async function assertProjectExternalMode(project: RelayProject, homeDir: string): Promise<void> {
  const filePath = presenceRecordPath(project.projectId, homeDir)
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"))
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`presence record is not an object for ${project.projectId}`)
  }
  const record = parsed as Record<string, unknown>
  if (record["mode"] !== "external" || typeof record["serverUrl"] !== "string" || record["serverUrl"] === "") {
    throw new Error(`project ${project.projectId} is not externally reachable`)
  }
}
