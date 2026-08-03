import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { MAILBOX_MODES } from "../envelope/schema"
import type { MailboxMessage, MailboxMode } from "../envelope/schema"

export const CLASSIFIER_CATEGORY = "quick"
export const DEFAULT_CLASSIFIER_TIMEOUT_MS = 30_000

export type ClassifyFailureReason = "timeout" | "parse-failure" | "classifier-error"

export type ClassifyResult =
  | { readonly mode: MailboxMode | undefined }
  | { readonly mode: undefined; readonly reason: ClassifyFailureReason }

export interface ClassificationCacheFs {
  mkdir(dir: string): Promise<void>
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(filePath: string): Promise<void>
}

export interface ClassificationCacheOptions {
  readonly repoRoot: string
  readonly ttlMs: number
  readonly fs?: ClassificationCacheFs
  readonly now?: () => number
}

export interface ClassifierTimerPort {
  setTimeout(callback: () => void, timeoutMs: number): ReturnType<typeof globalThis.setTimeout>
  clearTimeout(handle: ReturnType<typeof globalThis.setTimeout>): void
}

export interface ClassifierDeps {
  readonly classify: (prompt: string) => Promise<string>
  readonly cache: ClassificationCache
  readonly timeoutMs?: number
  readonly timer?: ClassifierTimerPort
}

type ClassifierNote = {
  readonly envelope: MailboxMessage
  readonly body: string
}

interface ClassificationCacheData {
  readonly entries: readonly ClassificationCacheEntry[]
}

interface ClassificationCacheEntry {
  readonly messageId: string
  readonly mode: MailboxMode | null
  readonly reason?: ClassifyFailureReason
  readonly recordedAt: number
  readonly ttlMs: number
}

class ClassificationTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`mailbox classifier timed out after ${timeoutMs}ms`)
  }
}

const NODE_CLASSIFICATION_CACHE_FS: ClassificationCacheFs = {
  async mkdir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 })
  },
  async readFile(filePath: string): Promise<string> {
    return readFile(filePath, "utf8")
  },
  rename,
  rm,
  writeFile,
}

const DEFAULT_TIMER: ClassifierTimerPort = {
  clearTimeout: globalThis.clearTimeout,
  setTimeout: globalThis.setTimeout,
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function normalizeClassifierToken(raw: string): string {
  return raw.trim().toLowerCase()
}

function resolveMailboxMode(token: string): MailboxMode | undefined {
  for (const mode of MAILBOX_MODES) {
    if (token === mode) return mode
  }
  return undefined
}

function isFailureReason(value: unknown): value is ClassifyFailureReason {
  return value === "timeout" || value === "parse-failure" || value === "classifier-error"
}

function isClassificationCacheEntry(value: unknown): value is ClassificationCacheEntry {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const mode = record["mode"]
  const reason = record["reason"]
  return (
    typeof record["messageId"] === "string" &&
    (mode === null || (typeof mode === "string" && resolveMailboxMode(mode) !== undefined)) &&
    (reason === undefined || isFailureReason(reason)) &&
    typeof record["recordedAt"] === "number" &&
    typeof record["ttlMs"] === "number"
  )
}

function parseClassificationCacheData(content: string): ClassificationCacheData {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== "object" || parsed === null) return { entries: [] }
  const entries = (parsed as Record<string, unknown>)["entries"]
  if (!Array.isArray(entries)) return { entries: [] }
  return { entries: entries.filter(isClassificationCacheEntry) }
}

function entryToResult(entry: ClassificationCacheEntry): ClassifyResult {
  if (entry.reason !== undefined) return { mode: undefined, reason: entry.reason }
  if (entry.mode === null) return { mode: undefined }
  return { mode: entry.mode }
}

function resultToEntry(messageId: string, result: ClassifyResult, recordedAt: number, ttlMs: number): ClassificationCacheEntry {
  return {
    messageId,
    mode: result.mode ?? null,
    ...("reason" in result ? { reason: result.reason } : {}),
    recordedAt,
    ttlMs,
  }
}

export class ClassificationCache {
  private readonly fs: ClassificationCacheFs
  private readonly now: () => number
  private readonly repoRoot: string
  private readonly ttlMs: number

  constructor(options: ClassificationCacheOptions) {
    this.fs = options.fs ?? NODE_CLASSIFICATION_CACHE_FS
    this.now = options.now ?? Date.now
    this.repoRoot = options.repoRoot
    this.ttlMs = options.ttlMs
  }

  private get cachePath(): string {
    return path.join(this.repoRoot, "coordination_notes", ".classification-cache.json")
  }

  async get(messageId: string): Promise<ClassifyResult | undefined> {
    const nowMs = this.now()
    const data = await this.read()
    const live = data.entries.filter((entry) => nowMs - entry.recordedAt <= entry.ttlMs)
    const existing = live.find((entry) => entry.messageId === messageId)
    if (existing === undefined) {
      await this.atomicWrite({ entries: live })
      return undefined
    }
    await this.atomicWrite({ entries: live })
    return entryToResult(existing)
  }

  async record(messageId: string, result: ClassifyResult): Promise<void> {
    const nowMs = this.now()
    const data = await this.read()
    const live = data.entries.filter((entry) => nowMs - entry.recordedAt <= entry.ttlMs && entry.messageId !== messageId)
    await this.atomicWrite({ entries: [...live, resultToEntry(messageId, result, nowMs, this.ttlMs)] })
  }

  private async read(): Promise<ClassificationCacheData> {
    try {
      const content = await this.fs.readFile(this.cachePath)
      return parseClassificationCacheData(content)
    } catch (error) {
      if (isMissingPath(error)) return { entries: [] }
      if (error instanceof SyntaxError) return { entries: [] }
      throw error
    }
  }

  private async atomicWrite(data: ClassificationCacheData): Promise<void> {
    const dir = path.dirname(this.cachePath)
    await this.fs.mkdir(dir)
    const tmpPath = path.join(dir, `.tmp-classification-cache-${randomUUID()}.json`)
    const content = `${JSON.stringify(data, null, 2)}\n`
    try {
      await this.fs.writeFile(tmpPath, content)
      await this.fs.rename(tmpPath, this.cachePath)
    } catch (error) {
      await this.fs.rm(tmpPath)
      throw error
    }
  }
}

function buildClassifierPrompt(note: ClassifierNote): string {
  return [
    `Respond with EXACTLY one word from this list: ${MAILBOX_MODES.join(", ")}, triage. No other text.`,
    `Message ID: ${note.envelope.messageId}`,
    `Intent: ${note.envelope.intent}`,
    note.envelope.category === undefined ? "Category: none" : `Category: ${note.envelope.category}`,
    "Body:",
    note.body,
  ].join("\n")
}

function parseClassifierResponse(raw: string): ClassifyResult {
  const token = normalizeClassifierToken(raw)
  if (token === "triage") return { mode: undefined }
  const mode = resolveMailboxMode(token)
  if (mode === undefined) return { mode: undefined, reason: "parse-failure" }
  return { mode }
}

function classifyWithTimeout(prompt: string, deps: ClassifierDeps): Promise<string> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_CLASSIFIER_TIMEOUT_MS
  const timer = deps.timer ?? DEFAULT_TIMER
  return new Promise((resolve, reject) => {
    let settled = false
    const handle = timer.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new ClassificationTimeoutError(timeoutMs))
    }, timeoutMs)
    deps.classify(prompt).then(
      (value) => {
        if (settled) return
        settled = true
        timer.clearTimeout(handle)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        timer.clearTimeout(handle)
        reject(error)
      },
    )
  })
}

// classifyNote is only for legacy ambiguous notes after decideRoute returns lane "classify".
// Callers must not pass notes that already carry requested_mode; this guard keeps accidental
// misuse from consuming background quick-category tokens or bypassing receiver-side gating.
export async function classifyNote(note: ClassifierNote, deps: ClassifierDeps): Promise<ClassifyResult> {
  if (note.envelope.requested_mode !== undefined) return { mode: undefined, reason: "parse-failure" }
  try {
    const cached = await deps.cache.get(note.envelope.messageId)
    if (cached !== undefined) return cached
    const raw = await classifyWithTimeout(buildClassifierPrompt(note), deps)
    const result = parseClassifierResponse(raw)
    await deps.cache.record(note.envelope.messageId, result)
    return result
  } catch (error) {
    if (error instanceof ClassificationTimeoutError) return { mode: undefined, reason: "timeout" }
    if (error instanceof Error) return { mode: undefined, reason: "classifier-error" }
    return { mode: undefined, reason: "classifier-error" }
  }
}
