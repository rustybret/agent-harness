import fs from "node:fs"
import path from "node:path"

function realpathOfNearestAncestor(target: string): string {
  let current = target
  while (true) {
    try {
      return fs.realpathSync(current)
    } catch (error) {
      const isMissingPath = error instanceof Error && "code" in error && error.code === "ENOENT"
      if (!isMissingPath) {
        throw error
      }
      const parent = path.dirname(current)
      if (parent === current) {
        return current
      }
      current = parent
    }
  }
}

export function assertPathWithinRoot(targetRoot: string, candidatePath: string): void {
  const resolvedRoot = fs.realpathSync(targetRoot)
  const resolved = path.resolve(targetRoot, candidatePath)
  const realResolved = realpathOfNearestAncestor(resolved)

  if (realResolved !== resolvedRoot && !realResolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path escapes root: ${candidatePath}`)
  }
}

export function safeMessageIdFilename(messageId: string): string {
  const hasControlChar = [...messageId].some((char) => char.charCodeAt(0) <= 0x1f)
  if (/[/\\]/.test(messageId) || hasControlChar) {
    throw new Error(`Unsafe messageId: ${messageId}`)
  }
  return `${messageId}.md`
}
