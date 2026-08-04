import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "fs"
import { log } from "../../shared"
import { MAX_TRACKED_PATHS_PER_SESSION } from "./hook"
import {
  asRecord,
  getPathFromArgs,
  isOverwriteEnabled,
  isPathInsideDirectory,
  resolveInputPath,
  toCanonicalPath,
  type GuardArgs,
} from "./hook"
import {
  evictLeastRecentlyUsedSession,
  touchSession,
  trimSessionReadSet,
} from "./session-read-permissions"

/**
 * Explains the block in terms of the two things that actually lift it.
 *
 * The guard is a read-before-overwrite rule, not a ban on `write`. "Use edit tool instead" names
 * neither exit: `edit` is the wrong advice when the intent IS to replace the whole file, and the
 * `overwrite` escape hatch appears in no tool schema, so it cannot be discovered from the tool
 * surface at all. Observed recovery after a block is split between reading, retrying `write`
 * unchanged, and switching to `edit` - and 3 of 5 immediate retries failed again.
 */
export function buildBlockedWriteMessage(filePath: string): string {
  return [
    `Refusing to overwrite ${filePath} because this session has not read it.`,
    `This guards against replacing content you have not seen; the file is unchanged.`,
    `To proceed: read ${filePath} first, then write (a read grants one overwrite), or pass overwrite: true to skip the read.`,
    `To change part of the file instead, use edit.`,
  ].join(" ")
}

function ensureSessionReadSet(params: {
  sessionID: string
  readPermissionsBySession: Map<string, Set<string>>
  sessionLastAccess: Map<string, number>
  maxTrackedSessions: number
}): Set<string> {
  const { sessionID, readPermissionsBySession, sessionLastAccess, maxTrackedSessions } = params
  let readSet = readPermissionsBySession.get(sessionID)
  if (!readSet) {
    if (readPermissionsBySession.size >= maxTrackedSessions) {
      evictLeastRecentlyUsedSession(readPermissionsBySession, sessionLastAccess)
    }

    readSet = new Set<string>()
    readPermissionsBySession.set(sessionID, readSet)
  }

  touchSession(sessionLastAccess, sessionID)
  return readSet
}

function registerReadPermission(params: {
  sessionID: string
  canonicalPath: string
  readPermissionsBySession: Map<string, Set<string>>
  sessionLastAccess: Map<string, number>
  maxTrackedSessions: number
  maxTrackedPathsPerSession: number
}): void {
  const readSet = ensureSessionReadSet(params)
  if (readSet.has(params.canonicalPath)) {
    readSet.delete(params.canonicalPath)
  }

  readSet.add(params.canonicalPath)
  trimSessionReadSet(readSet, params.maxTrackedPathsPerSession)
}

function consumeReadPermission(params: {
  sessionID: string
  canonicalPath: string
  readPermissionsBySession: Map<string, Set<string>>
  sessionLastAccess: Map<string, number>
}): boolean {
  const readSet = params.readPermissionsBySession.get(params.sessionID)
  if (!readSet || !readSet.has(params.canonicalPath)) {
    return false
  }

  readSet.delete(params.canonicalPath)
  touchSession(params.sessionLastAccess, params.sessionID)
  return true
}

function invalidateOtherSessions(
  readPermissionsBySession: Map<string, Set<string>>,
  canonicalPath: string,
  writingSessionID?: string,
): void {
  for (const [sessionID, readSet] of readPermissionsBySession.entries()) {
    if (writingSessionID && sessionID === writingSessionID) {
      continue
    }

    readSet.delete(canonicalPath)
  }
}

export function isOmoWorkspacePath(canonicalPath: string): boolean {
  return /(^|[/\\])\.omo([/\\]|$)/.test(canonicalPath)
}

export async function handleWriteExistingFileGuardToolExecuteBefore(params: {
  ctx: PluginInput
  input: { tool?: string; sessionID?: string }
  output: { args?: unknown }
  readPermissionsBySession: Map<string, Set<string>>
  sessionLastAccess: Map<string, number>
  getCanonicalSessionRoot: () => string
  maxTrackedSessions: number
  maxTrackedPathsPerSession?: number
}): Promise<void> {
  const {
    ctx,
    input,
    output,
    readPermissionsBySession,
    sessionLastAccess,
    getCanonicalSessionRoot,
    maxTrackedSessions,
    maxTrackedPathsPerSession = MAX_TRACKED_PATHS_PER_SESSION,
  } = params
  const toolName = input.tool?.toLowerCase()
  if (toolName !== "write" && toolName !== "read") {
    return
  }

  const argsRecord = asRecord(output.args)
  const args = argsRecord as GuardArgs | undefined
  const filePath = getPathFromArgs(args)
  if (!filePath) {
    return
  }

  const resolvedPath = resolveInputPath(ctx, filePath)
  const canonicalSessionRoot = getCanonicalSessionRoot()
  const canonicalPath = toCanonicalPath(resolvedPath)
  if (!isPathInsideDirectory(canonicalPath, canonicalSessionRoot)) {
    return
  }

  if (toolName === "read") {
    if (!existsSync(resolvedPath) || !input.sessionID) {
      return
    }

    registerReadPermission({
      sessionID: input.sessionID,
      canonicalPath,
      readPermissionsBySession,
      sessionLastAccess,
      maxTrackedSessions,
      maxTrackedPathsPerSession,
    })
    return
  }

  const overwriteEnabled = isOverwriteEnabled(args?.overwrite)
  if (argsRecord && "overwrite" in argsRecord) {
    const { overwrite: _, ...rest } = argsRecord
    ;(output as { args: Record<string, unknown> }).args = rest
  }

  if (!existsSync(resolvedPath)) {
    return
  }

  if (isOmoWorkspacePath(canonicalPath)) {
    log("[write-existing-file-guard] Allowing .omo/** overwrite", {
      sessionID: input.sessionID,
      filePath,
    })
    invalidateOtherSessions(readPermissionsBySession, canonicalPath, input.sessionID)
    return
  }

  if (overwriteEnabled) {
    log("[write-existing-file-guard] Allowing overwrite flag bypass", {
      sessionID: input.sessionID,
      filePath,
      resolvedPath,
    })
    invalidateOtherSessions(readPermissionsBySession, canonicalPath, input.sessionID)
    return
  }

  if (input.sessionID && consumeReadPermission({ sessionID: input.sessionID, canonicalPath, readPermissionsBySession, sessionLastAccess })) {
    log("[write-existing-file-guard] Allowing overwrite after read", {
      sessionID: input.sessionID,
      filePath,
      resolvedPath,
    })
    invalidateOtherSessions(readPermissionsBySession, canonicalPath, input.sessionID)
    return
  }

  log("[write-existing-file-guard] Blocking write to existing file", {
    sessionID: input.sessionID,
    filePath,
    resolvedPath,
  })

  throw new Error(buildBlockedWriteMessage(filePath))
}
