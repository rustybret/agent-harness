import { closeSync, openSync, readSync, statSync } from "node:fs"

import { isMissingPathError } from "@oh-my-opencode/utils"

import { log } from "../../../shared/logger"

/**
 * Reads the trailing bytes of an append-only log and returns its complete lines.
 *
 * The first line in the window is dropped when the read started mid-file, since a byte-bounded tail
 * can slice a record in half and a half-line would parse as corrupt rather than as absent.
 */
export function readLastLines(filePath: string, maxBytes: number): string[] {
  let fd: number | null = null
  try {
    const size = statSync(filePath).size
    fd = openSync(filePath, "r")
    const length = Math.min(size, maxBytes)
    const offset = Math.max(0, size - maxBytes)
    const buf = Buffer.alloc(length)
    if (length > 0) readSync(fd, buf, 0, length, offset)
    const lines = buf
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    return offset > 0 ? lines.slice(1) : lines
  } catch (error) {
    // An outbox that has never been written to is the normal state for a project that has not sent
    // anything yet, not a read failure worth reporting on every poll.
    if (!isMissingPathError(error)) log("mailbox outbox tail read failed", { error, filePath })
    return []
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
