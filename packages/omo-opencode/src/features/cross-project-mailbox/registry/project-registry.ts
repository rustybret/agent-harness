import { randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import { mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { projectIdForRoot } from "../envelope/project-id"
import { type ProjectEntry, ProjectNotFoundError, type RegistryData } from "./types"

const LOCK_RETRY_MS = 50
const LOCK_WAIT_TIMEOUT_MS = 15_000
const LOCK_STALE_AFTER_MS = 300_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function sortEntries(entries: readonly ProjectEntry[]): ProjectEntry[] {
  return [...entries].sort(
    (left, right) =>
      right.lastSeen - left.lastSeen || left.displayName.localeCompare(right.displayName),
  )
}

function isProjectEntry(value: unknown): value is ProjectEntry {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record["projectId"] === "string" &&
    typeof record["repoRoot"] === "string" &&
    typeof record["displayName"] === "string" &&
    typeof record["lastSeen"] === "number"
  )
}

function parseRegistryData(content: string): RegistryData {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== "object" || parsed === null) return { projects: [] }
  const projects = (parsed as Record<string, unknown>)["projects"]
  if (!Array.isArray(projects)) return { projects: [] }
  return { projects: projects.filter(isProjectEntry) }
}

function buildLockOwnerContent(): string {
  return `project-registry\n${process.pid}\n${Date.now()}\n`
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return false
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  try {
    const content = await readFile(lockPath, "utf8")
    const lines = content.split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length !== 3) return false
    const ownerPid = Number.parseInt(lines[1] ?? "", 10)
    const acquiredAt = Number.parseInt(lines[2] ?? "", 10)
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) return false
    if (!Number.isInteger(acquiredAt) || acquiredAt <= 0) return false
    if (isPidAlive(ownerPid)) return false
    return Date.now() - acquiredAt > LOCK_STALE_AFTER_MS
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return false
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await unlink(lockPath).catch((error: unknown) => {
    if (error instanceof Error) return undefined
    return undefined
  })
}

async function acquireLock(lockPath: string): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    if (Date.now() - startedAt > LOCK_WAIT_TIMEOUT_MS) {
      throw new Error(`Timed out acquiring lock: ${lockPath}`)
    }
    try {
      const fileHandle = await open(lockPath, "wx")
      try {
        await fileHandle.writeFile(buildLockOwnerContent())
      } finally {
        await fileHandle.close()
      }
      return
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== "EEXIST") throw error
      if (await isStaleLock(lockPath)) {
        await releaseLock(lockPath)
        continue
      }
      await delay(LOCK_RETRY_MS)
    }
  }
}

export function defaultRegistryPath(): string {
  return path.join(os.homedir(), ".omo", "project-registry.json")
}

export function createProjectRegistry(registryPath?: string): ProjectRegistry {
  return new ProjectRegistry(registryPath ?? defaultRegistryPath())
}

export class ProjectRegistry {
  constructor(private readonly registryPath: string) {}

  async registerProject(repoRoot: string): Promise<void> {
    const canonicalRoot = realpathSync(repoRoot)
    const projectId = projectIdForRoot(canonicalRoot)
    const entry: ProjectEntry = {
      projectId,
      repoRoot: canonicalRoot,
      displayName: path.basename(canonicalRoot),
      lastSeen: Date.now(),
    }
    await this.withRegistryLock(async () => {
      const data = await this.readRegistry()
      const merged = data.projects.filter((existing) => existing.projectId !== projectId)
      merged.push(entry)
      await this.atomicWrite({ projects: sortEntries(merged) })
    })
  }

  async resolveTargetRepoRoot(projectId: string): Promise<string> {
    const data = await this.readRegistry()
    const match = data.projects.find((entry) => entry.projectId === projectId)
    if (match === undefined) throw new ProjectNotFoundError(projectId)
    return match.repoRoot
  }

  async listProjects(): Promise<ProjectEntry[]> {
    const data = await this.readRegistry()
    return sortEntries(data.projects)
  }

  async discoverFromOpenClaw(openclawRegistryPath: string): Promise<void> {
    let content: string
    try {
      content = await readFile(openclawRegistryPath, "utf8")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return
    }
    const candidatePaths: string[] = []
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch (error) {
        if (error instanceof SyntaxError) continue
        throw error
      }
      if (typeof parsed !== "object" || parsed === null) continue
      const projectPath = (parsed as Record<string, unknown>)["projectPath"]
      if (typeof projectPath === "string" && projectPath.length > 0) {
        candidatePaths.push(projectPath)
      }
    }
    for (const projectPath of candidatePaths) {
      try {
        await this.registerProject(projectPath)
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
    }
  }

  private async readRegistry(): Promise<RegistryData> {
    try {
      const content = await readFile(this.registryPath, "utf8")
      return parseRegistryData(content)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === "ENOENT") return { projects: [] }
      if (error instanceof SyntaxError) return { projects: [] }
      throw error
    }
  }

  private async atomicWrite(data: RegistryData): Promise<void> {
    await mkdir(path.dirname(this.registryPath), { recursive: true })
    const tmpPath = `${this.registryPath}.tmp-registry-${randomUUID()}.json`
    const content = `${JSON.stringify(data, null, 2)}\n`
    try {
      const fileHandle = await open(tmpPath, "wx")
      try {
        await fileHandle.writeFile(content)
      } finally {
        await fileHandle.close()
      }
      await rename(tmpPath, this.registryPath)
    } catch (error) {
      await rm(tmpPath, { force: true })
      throw error
    }
  }

  private async withRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(path.dirname(this.registryPath), { recursive: true })
    const lockPath = `${this.registryPath}.lock`
    await acquireLock(lockPath)
    try {
      return await fn()
    } finally {
      await releaseLock(lockPath)
    }
  }
}
