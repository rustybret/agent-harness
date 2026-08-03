import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { log } from "../../../shared/logger"
import { spawnWithWindowsHide } from "../../../shared/spawn-with-windows-hide"
import { buildWorkerPrWorkOrder, resolveWorkerPrPaths } from "./worker-order"
import type { WorkerPrPaths } from "./worker-order"
import type { UnreadMessage } from "../mailbox/types"

const DEFAULT_WORKER_DEADLINE_MINUTES = 60
const MINUTE_MS = 60_000
const SOURCE_WRAPPER_PATH = "./worker-pr/run-worker.mjs"
const DIST_WRAPPER_PATH = "./worker-pr/run-worker.js"

export type WorkerPrExecGit = (args: readonly string[], options: { readonly cwd: string }) => Promise<void>

export type WorkerPrSpawnOptions = {
  readonly cwd: string
}

export type WorkerPrSpawnResult = {
  readonly pid?: number
  readonly unref?: () => void
}

export type WorkerPrSpawn = (command: readonly string[], options: WorkerPrSpawnOptions) => WorkerPrSpawnResult

export type WorkerPrLaneDeps = {
  readonly execGit?: WorkerPrExecGit
  readonly now?: () => number
  readonly repoRoot: string
  readonly spawn?: WorkerPrSpawn
  readonly wrapperPath?: string
  readonly writeWorkOrder?: (filePath: string, content: string) => Promise<void>
}

export type WorkerPrLaneResult = {
  readonly branchName: string
  readonly status: "spawned"
  readonly workOrderPath: string
  readonly worktreePath: string
}

export type WorkerPrLane = {
  readonly fulfill: (note: UnreadMessage) => Promise<WorkerPrLaneResult>
}

export type ResolveWorkerPrDeadlineInput = {
  readonly now: number
  readonly envValue?: string
}

function readOptionalFunction(value: object, key: string): (() => void) | undefined {
  const candidate = Reflect.get(value, key)
  return typeof candidate === "function" ? () => candidate.call(value) : undefined
}

function readOptionalNumber(value: object, key: string): number | undefined {
  const candidate = Reflect.get(value, key)
  return typeof candidate === "number" ? candidate : undefined
}

async function defaultExecGit(args: readonly string[], options: { readonly cwd: string }): Promise<void> {
  const child = spawnWithWindowsHide(["git", ...args], {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed with exit code ${exitCode}`)
  }
}

function defaultSpawn(command: readonly string[], options: WorkerPrSpawnOptions): WorkerPrSpawnResult {
  const child = spawnWithWindowsHide([...command], {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  return {
    ...(readOptionalNumber(child, "pid") === undefined ? {} : { pid: readOptionalNumber(child, "pid") }),
    ...(readOptionalFunction(child, "unref") === undefined ? {} : { unref: readOptionalFunction(child, "unref") }),
  }
}

async function defaultWriteWorkOrder(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await writeFile(filePath, content, "utf8")
}

function currentModuleFilePath(): string {
  return fileURLToPath(import.meta.url)
}

function defaultWrapperPath(): string {
  const currentPath = currentModuleFilePath()
  if (currentPath.endsWith(path.join("dist", "index.js"))) {
    return path.join(path.dirname(currentPath), DIST_WRAPPER_PATH)
  }
  return fileURLToPath(new URL(SOURCE_WRAPPER_PATH, import.meta.url))
}

export function resolveWorkerPrDeadlineMs(input: ResolveWorkerPrDeadlineInput): number {
  const parsed = input.envValue === undefined ? Number.NaN : Number(input.envValue)
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WORKER_DEADLINE_MINUTES
  return input.now + (minutes * MINUTE_MS)
}

function wrapperCommand(input: {
  readonly deadline: number
  readonly paths: WorkerPrPaths
  readonly wrapperPath: string
}): readonly string[] {
  return [
    "bun",
    input.wrapperPath,
    "--worktree",
    input.paths.worktreePath,
    "--work-order",
    input.paths.workOrderPath,
    "--run-record",
    input.paths.runRecordPath,
    "--deadline",
    String(input.deadline),
  ]
}

export function createWorkerPrLane(deps: WorkerPrLaneDeps): WorkerPrLane {
  const execGit = deps.execGit ?? defaultExecGit
  const now = deps.now ?? Date.now
  const spawn = deps.spawn ?? defaultSpawn
  const wrapperPath = deps.wrapperPath ?? defaultWrapperPath()
  const writeWorkOrder = deps.writeWorkOrder ?? defaultWriteWorkOrder

  return {
    async fulfill(note): Promise<WorkerPrLaneResult> {
      const paths = resolveWorkerPrPaths({ messageId: note.messageId, repoRoot: deps.repoRoot })
      const workOrder = buildWorkerPrWorkOrder({ note, paths })
      await writeWorkOrder(paths.workOrderPath, workOrder)
      await execGit(["worktree", "add", paths.worktreePath, "-b", paths.branchName], { cwd: deps.repoRoot })
      const deadline = resolveWorkerPrDeadlineMs({ now: now(), envValue: process.env.OMO_MAILBOX_WORKER_DEADLINE_MIN })
      const result = spawn(wrapperCommand({ deadline, paths, wrapperPath }), { cwd: deps.repoRoot })
      result.unref?.()
      log("[mailbox-worker-pr] spawned worker", { branchName: paths.branchName, messageId: note.messageId, pid: result.pid, worktreePath: paths.worktreePath })
      return {
        branchName: paths.branchName,
        status: "spawned",
        workOrderPath: paths.workOrderPath,
        worktreePath: paths.worktreePath,
      }
    },
  }
}
