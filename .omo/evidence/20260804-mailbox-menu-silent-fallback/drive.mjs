// Reproduces the art3d-pipeline symptom: every project renders "Disabled" and a permission edit
// appears to do nothing. Drives the REAL live-config resolver and the REAL buildTopMenu against a
// sandbox repo whose config is unreadable, and records whether the operator is told why.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = "/Volumes/Topper2TB/Git/agent-harness"
const { createLiveMailboxConfigResolver } = await import(
  `${root}/packages/omo-opencode/src/features/cross-project-mailbox/config/live-config.ts`
)
const { buildTopMenu } = await import(
  `${root}/packages/omo-opencode/src/features/cross-project-mailbox/dialog/menu-model.ts`
)
const { _setLoggerForTesting, _resetLoggerForTesting } = await import(
  `${root}/packages/omo-opencode/src/shared/logger.ts`
)

const FALLBACK = { enabled: true }
const ENTRIES = [
  { projectId: "cloudhome-5aa53d2c", displayName: "cloudhome", repoRoot: "/tmp/a" },
  { projectId: "atlas-1c0ff33a", displayName: "atlas", repoRoot: "/tmp/b" },
  { projectId: "agent-harness-0367cd71", displayName: "agent-harness", repoRoot: "/tmp/c" },
]

function sandboxWithBrokenConfig() {
  const dir = mkdtempSync(join(tmpdir(), "mailbox-menu-qa-"))
  mkdirSync(join(dir, ".omo"), { recursive: true })
  // Truncated mid-object: the exact shape a half-written config edit leaves behind.
  writeFileSync(join(dir, ".omo", "omo.jsonc"), '{ "[opencode]": { "cross_project_mailbox": {')
  return dir
}

const lines = []
_setLoggerForTesting({
  sink: (message, data) =>
    void lines.push(data === undefined ? message : `${message} ${JSON.stringify(data)}`),
})

const dir = sandboxWithBrokenConfig()
try {
  const resolver = createLiveMailboxConfigResolver(dir, FALLBACK)
  const config = await resolver.resolve()
  const rows = buildTopMenu(ENTRIES, config, "art3d-pipeline-6e240ea8")
  const mailboxLines = lines.filter((l) => l.includes("[mailbox-live-config]"))

  console.log(
    JSON.stringify(
      {
        symptom: {
          rows: rows.map((r) => `${r.label}=${r.state}`),
          allDisabled: rows.every((r) => r.state === "Disabled"),
        },
        operatorIsTold: mailboxLines.length > 0,
        logLines: mailboxLines,
      },
      null,
      2,
    ),
  )
} finally {
  _resetLoggerForTesting()
  rmSync(dir, { recursive: true, force: true })
}
