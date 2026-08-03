import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { log as defaultLog } from "../../../shared/logger"
import { spawnWithWindowsHide } from "../../../shared/spawn-with-windows-hide"
import { resolveWorkerPrPaths } from "./worker-order"

const FAILED_WORKTREE_CAP = 5

export const WorkerPrRunRecordSchema = z.object({
  pid: z.number().int(),
  startedAt: z.number().int(),
  deadline: z.number().int(),
  exitCode: z.number().int().optional(),
  finishedAt: z.number().int().optional(),
}).strict()

export type WorkerPrRunRecord = z.infer<typeof WorkerPrRunRecordSchema>

export type WorkerPrRunRecordEntry = {
  readonly messageId: string
  readonly record: WorkerPrRunRecord
}

export type WorkerPrWatchdogDeps = {
  readonly checkWorkerReplyExists: (messageId: string) => Promise<boolean>
  readonly execGit?: (args: readonly string[], options: { readonly cwd: string }) => Promise<void>
  readonly log?: (message: string, context?: Record<string, unknown>) => void
  readonly now: () => number
  readonly readRunRecords?: () => Promise<readonly WorkerPrRunRecordEntry[]>
  readonly repoRoot: string
  readonly sendFallbackReply: (messageId: string, body: string) => Promise<void>
  readonly writeRunRecord?: (messageId: string, record: WorkerPrRunRecord) => Promise<void>
}

async function defaultExecGit(args: readonly string[], options: { readonly cwd: string }): Promise<void> {
  const child = spawnWithWindowsHide(["git", ...args], {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed with exit code ${exitCode}`)
  }
}

function runsDir(repoRoot: string): string {
  return path.join(repoRoot, ".omo", "mailbox-work", "runs")
}

function replyMarkerPath(repoRoot: string, messageId: string): string {
  return path.join(repoRoot, ".omo", "mailbox-work", "replies", `${messageId}.json`)
}

async function defaultReadRunRecords(repoRoot: string): Promise<readonly WorkerPrRunRecordEntry[]> {
  let names: string[]
  try {
    names = await readdir(runsDir(repoRoot))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
  const records: WorkerPrRunRecordEntry[] = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const messageId = name.slice(0, -".json".length)
    const fileContent = await readFile(path.join(runsDir(repoRoot), name), "utf8")
    records.push({ messageId, record: WorkerPrRunRecordSchema.parse(JSON.parse(fileContent)) })
  }
  return records
}

async function defaultWriteRunRecord(repoRoot: string, messageId: string, record: WorkerPrRunRecord): Promise<void> {
  const filePath = path.join(runsDir(repoRoot), `${messageId}.json`)
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  await writeFile(filePath, `${JSON.stringify(WorkerPrRunRecordSchema.parse(record), null, 2)}\n`, "utf8")
}

export async function defaultCheckWorkerReplyExists(repoRoot: string, messageId: string): Promise<boolean> {
  try {
    await stat(replyMarkerPath(repoRoot, messageId))
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

function successWarningBody(messageId: string): string {
  return `status: success-with-warning\nmessageId: ${messageId}\nPR URL: worker exited successfully, but the watchdog did not find the worker reply marker. Review the worker run output and mailbox outbox before merging.`
}

function failureBody(messageId: string, exitCode: number): string {
  return `status: failed\nmessageId: ${messageId}\nexitCode: ${exitCode}\nPR URL: unavailable\nnext: inspect kept worker worktree and rerun or iterate.`
}

function failedRecord(entry: WorkerPrRunRecordEntry, now: number): WorkerPrRunRecordEntry | undefined {
  if (entry.record.exitCode !== undefined && entry.record.exitCode !== 0) return entry
  if (entry.record.exitCode === undefined && entry.record.deadline < now) {
    return { messageId: entry.messageId, record: { ...entry.record, exitCode: -1, finishedAt: now } }
  }
  return undefined
}

async function pruneWorktree(input: {
  readonly execGit: (args: readonly string[], options: { readonly cwd: string }) => Promise<void>
  readonly messageId: string
  readonly repoRoot: string
}): Promise<void> {
  const paths = resolveWorkerPrPaths({ messageId: input.messageId, repoRoot: input.repoRoot })
  await input.execGit(["worktree", "remove", paths.worktreePath], { cwd: input.repoRoot })
}

async function handleCompletedSuccess(input: {
  readonly deps: WorkerPrWatchdogDeps
  readonly entry: WorkerPrRunRecordEntry
  readonly execGit: (args: readonly string[], options: { readonly cwd: string }) => Promise<void>
}): Promise<void> {
  if (!await input.deps.checkWorkerReplyExists(input.entry.messageId)) {
    await input.deps.sendFallbackReply(input.entry.messageId, successWarningBody(input.entry.messageId))
  }
  await pruneWorktree({ execGit: input.execGit, messageId: input.entry.messageId, repoRoot: input.deps.repoRoot })
}

async function handleFailedRecord(input: {
  readonly deps: WorkerPrWatchdogDeps
  readonly entry: WorkerPrRunRecordEntry
  readonly writeRunRecord: (messageId: string, record: WorkerPrRunRecord) => Promise<void>
}): Promise<void> {
  await input.deps.sendFallbackReply(input.entry.messageId, failureBody(input.entry.messageId, input.entry.record.exitCode ?? -1))
  await input.writeRunRecord(input.entry.messageId, input.entry.record)
}

async function enforceFailedCap(input: {
  readonly execGit: (args: readonly string[], options: { readonly cwd: string }) => Promise<void>
  readonly failed: readonly WorkerPrRunRecordEntry[]
  readonly log: (message: string, context?: Record<string, unknown>) => void
  readonly repoRoot: string
}): Promise<void> {
  if (input.failed.length <= FAILED_WORKTREE_CAP) return
  const sorted = [...input.failed].sort((left, right) => (left.record.finishedAt ?? left.record.startedAt) - (right.record.finishedAt ?? right.record.startedAt))
  const pruneCount = sorted.length - FAILED_WORKTREE_CAP
  for (const entry of sorted.slice(0, pruneCount)) {
    await pruneWorktree({ execGit: input.execGit, messageId: entry.messageId, repoRoot: input.repoRoot })
    input.log("[mailbox-worker-pr] pruned failed worker-pr worktree", { messageId: entry.messageId })
  }
}

export async function runWorkerPrWatchdogTick(deps: WorkerPrWatchdogDeps): Promise<void> {
  const execGit = deps.execGit ?? defaultExecGit
  const log = deps.log ?? defaultLog
  const readRunRecords = deps.readRunRecords ?? (() => defaultReadRunRecords(deps.repoRoot))
  const writeRunRecord = deps.writeRunRecord ?? ((messageId, record) => defaultWriteRunRecord(deps.repoRoot, messageId, record))
  const now = deps.now()
  const records = await readRunRecords()
  const failed: WorkerPrRunRecordEntry[] = []
  for (const entry of records) {
    if (entry.record.exitCode === 0) {
      await handleCompletedSuccess({ deps, entry, execGit })
      continue
    }
    const failedEntry = failedRecord(entry, now)
    if (failedEntry !== undefined) {
      failed.push(failedEntry)
      await handleFailedRecord({ deps, entry: failedEntry, writeRunRecord })
    }
  }
  await enforceFailedCap({ execGit, failed, log, repoRoot: deps.repoRoot })
}
