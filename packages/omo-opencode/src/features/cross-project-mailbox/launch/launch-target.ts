import os from "node:os"
import path from "node:path"

import { log } from "../../../shared/logger"
import { spawnWithWindowsHide } from "../../../shared/spawn-with-windows-hide"

export type LaunchPolicy = "disabled" | "ask" | "auto"

const DEFAULT_SPAWN_TIMEOUT_MS = 5_000
const LAUNCH_COMMAND = ["opencode", "--headless"]

export interface LaunchSpawnOptions {
  cwd: string
  logPath: string
}

export interface LaunchSpawnResult {
  pid?: number
  unref?: () => void
  confirm?: Promise<void>
}

export type LaunchSpawn = (command: string[], options: LaunchSpawnOptions) => LaunchSpawnResult

export interface LaunchTargetDeps {
  spawn?: LaunchSpawn
  spawnTimeoutMs?: number
}

export interface LaunchTargetOptions {
  policy: LaunchPolicy
  projectId: string
  launchPermissionAsk?: (target: string) => Promise<boolean>
  deps?: LaunchTargetDeps
}

function launchLogPath(projectId: string): string {
  return path.join(os.tmpdir(), `omo-launch-${projectId}.log`)
}

function defaultSpawn(command: string[], options: LaunchSpawnOptions): LaunchSpawnResult {
  spawnWithWindowsHide(command, {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  return { confirm: undefined }
}

async function confirmSpawn(result: LaunchSpawnResult, timeoutMs: number): Promise<boolean> {
  if (result.confirm === undefined) return true

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([
      result.confirm.then(() => true).catch(() => false),
      timeout,
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function launchTargetSession(
  repoRoot: string,
  options: LaunchTargetOptions,
): Promise<boolean> {
  if (options.policy === "disabled") return false

  if (options.policy === "ask") {
    if (options.launchPermissionAsk === undefined) return false
    const allowed = await options.launchPermissionAsk(repoRoot).catch(() => false)
    if (!allowed) return false
  }

  const spawn = options.deps?.spawn ?? defaultSpawn
  const timeoutMs = options.deps?.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS

  try {
    const result = spawn(LAUNCH_COMMAND, {
      cwd: repoRoot,
      logPath: launchLogPath(options.projectId),
    })
    result.unref?.()
    return await confirmSpawn(result, timeoutMs)
  } catch (error) {
    log("[launch-target] failed to launch target session", {
      error: error instanceof Error ? error.message : String(error),
      projectId: options.projectId,
    })
    return false
  }
}
