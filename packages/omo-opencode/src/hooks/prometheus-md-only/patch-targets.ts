// Extract target file paths from an apply_patch patchText body. Mirrors OpenCode core
// patch.ts parsing (packages/core/src/patch.ts): headers are "*** Add File:",
// "*** Delete File:", "*** Update File:", plus "*** Move to:" for update destinations.
const HEADERS = [
  "*** Add File:",
  "*** Delete File:",
  "*** Update File:",
  "*** Move to:",
] as const

export function extractPatchTargets(patchText: string): string[] {
  const targets: string[] = []
  for (const rawLine of patchText.split(/\r?\n/)) {
    const line = rawLine.trim()
    for (const header of HEADERS) {
      if (line.startsWith(header)) {
        const path = line.slice(header.length).trim()
        if (path) targets.push(path)
      }
    }
  }
  return targets
}
