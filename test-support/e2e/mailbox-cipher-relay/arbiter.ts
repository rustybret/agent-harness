import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { DEFAULT_TIMEOUT_MINUTES, type ArbiterReport, type RelayFinalDrop, type RelayHopReport, type RelaySandbox } from "./types"

export interface ArbiterOptions {
  readonly timeoutMinutes?: number
  readonly pollMs?: number
  readonly finalFile?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseTimeoutMinutes(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit
  const raw = process.env["MAILBOX_E2E_TIMEOUT_MIN"]
  if (raw === undefined || raw.trim() === "") return DEFAULT_TIMEOUT_MINUTES
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MINUTES
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isHopReport(value: unknown): value is RelayHopReport {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record["projectId"] === "string" && Array.isArray(record["substituted"])
}

function parseFinalDrop(content: string): RelayFinalDrop {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, unknown>
    if (typeof record["sentence"] === "string" && Array.isArray(record["hops"]) && record["hops"].every(isHopReport)) {
      return { sentence: record["sentence"], hops: record["hops"] }
    }
  }
  if (isStringArray(parsed)) {
    return { sentence: parsed.join(" "), hops: [] }
  }
  if (typeof parsed === "string") {
    return { sentence: parsed, hops: [] }
  }
  throw new Error("final drop must be a string, string array, or { sentence, hops } object")
}

export async function runArbiter(sandbox: RelaySandbox, options: ArbiterOptions = {}): Promise<ArbiterReport> {
  const started = Date.now()
  const timeoutMs = parseTimeoutMinutes(options.timeoutMinutes) * 60_000
  const pollMs = options.pollMs ?? 500
  const finalPath = path.join(sandbox.arbiterDropDir, options.finalFile ?? "final.json")
  await mkdir(path.dirname(sandbox.reportPath), { recursive: true, mode: 0o700 })

  let actualDrop: RelayFinalDrop | undefined
  let error: string | undefined
  while (Date.now() - started <= timeoutMs) {
    try {
      actualDrop = parseFinalDrop(await readFile(finalPath, "utf8"))
      break
    } catch (readError) {
      if (readError instanceof Error && "code" in readError && readError.code === "ENOENT") {
        await sleep(pollMs)
        continue
      }
      error = readError instanceof Error ? readError.message : String(readError)
      break
    }
  }

  const actual = actualDrop?.sentence
  const passed = actual === sandbox.expectedSentence && error === undefined
  const report: ArbiterReport = {
    passed,
    expected: sandbox.expectedSentence,
    ...(actual === undefined ? {} : { actual }),
    elapsedMs: Date.now() - started,
    hops: actualDrop?.hops ?? [],
    finalPath,
    ...(error === undefined ? {} : { error }),
  }
  await writeFile(sandbox.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return report
}
