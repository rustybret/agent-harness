import { chmod, mkdir, open, rename, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"

export const PRESENCE_TTL_MS = 30_000
export const PRESENCE_INTERVAL_MS = 10_000

const PRESENCE_FILE_MODE = 0o600

export type PresenceMode = "internal" | "external"

export interface PresenceRecord {
  projectId: string
  repoRoot: string
  mode: PresenceMode
  serverUrl: string | null
  sessionId: string
  pid: number
  heartbeatTs: number
}

export function presenceDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".omo", "presence")
}

export function presenceRecordPath(projectId: string, homeDir: string = os.homedir()): string {
  return path.join(presenceDir(homeDir), `${projectId}.json`)
}

export async function writePresenceRecord(
  record: PresenceRecord,
  homeDir: string = os.homedir(),
): Promise<void> {
  const dir = presenceDir(homeDir)
  await mkdir(dir, { recursive: true })

  const finalPath = presenceRecordPath(record.projectId, homeDir)
  const tmpPath = path.join(dir, `.${record.projectId}.${randomUUID()}.tmp`)
  const content = `${JSON.stringify(record, null, 2)}\n`

  try {
    const fileHandle = await open(tmpPath, "wx", PRESENCE_FILE_MODE)
    try {
      await fileHandle.writeFile(content)
    } finally {
      await fileHandle.close()
    }
    await chmod(tmpPath, PRESENCE_FILE_MODE)
    await rename(tmpPath, finalPath)
  } catch (error) {
    await rm(tmpPath, { force: true })
    throw error
  }
}
