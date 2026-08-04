// Drives the REAL write-existing-file-guard hook through its registered tool.execute.before entry
// point, replaying the shape that produced 21 blocks across 10 real sessions: a write to a file
// the session has not read. Then exercises both documented recovery paths against the same hook
// instance to prove the message describes behaviour that actually exists.
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { createWriteExistingFileGuardHook } = await import(
  "../../packages/omo-opencode/src/hooks/write-existing-file-guard/hook.ts"
)

const root = mkdtempSync(join(tmpdir(), "write-guard-qa-"))
const target = join(root, "config.ts")
writeFileSync(target, "export const original = true\n")

const hook = createWriteExistingFileGuardHook({ directory: root })
const before = hook["tool.execute.before"]

async function attemptWrite(sessionID, args) {
  const output = { args: { ...args } }
  try {
    await before({ tool: "write", sessionID }, output)
    return { blocked: false, args: output.args }
  } catch (error) {
    return { blocked: true, message: error.message }
  }
}

async function registerRead(sessionID, filePath) {
  await before({ tool: "read", sessionID }, { args: { filePath } })
}

const blocked = await attemptWrite("ses-a", { filePath: target, content: "replaced" })

await registerRead("ses-b", target)
const afterRead = await attemptWrite("ses-b", { filePath: target, content: "replaced" })

const withFlag = await attemptWrite("ses-c", {
  filePath: target,
  content: "replaced",
  overwrite: true,
})

const message = blocked.message ?? ""
console.log(
  JSON.stringify(
    {
      blockedMessage: message,
      messageChars: message.length,
      namesFile: message.includes(target),
      saysFileUnchanged: /unchanged/.test(message),
      namesReadRecovery: /read .* first, then write/.test(message),
      namesOverwriteFlag: message.includes("overwrite: true"),
      fileStillOriginal: readFileSync(target, "utf8").includes("original"),
      recoveryPathsWork: {
        readThenWrite: afterRead.blocked === false,
        overwriteFlag: withFlag.blocked === false,
        overwriteStrippedFromArgs:
          withFlag.blocked === false && !("overwrite" in (withFlag.args ?? {})),
      },
    },
    null,
    2,
  ),
)
