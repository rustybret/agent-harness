#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function requireArg(name) {
  const value = readArg(name)
  if (!value) {
    throw new Error(`missing ${name}`)
  }
  return value
}

async function writeRecord(runRecordPath, record) {
  await mkdir(path.dirname(runRecordPath), { recursive: true, mode: 0o700 })
  await writeFile(runRecordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8")
}

const worktree = requireArg("--worktree")
const workOrder = requireArg("--work-order")
const runRecord = requireArg("--run-record")
const deadline = Number(requireArg("--deadline"))

const startedAt = Date.now()
const child = Bun.spawn(["opencode", "run", await readFile(workOrder, "utf8")], {
  cwd: worktree,
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
})

await writeRecord(runRecord, { pid: child.pid, startedAt, deadline })
const exitCode = await child.exited
await writeRecord(runRecord, { pid: child.pid, startedAt, deadline, exitCode, finishedAt: Date.now() })
process.exit(exitCode)
