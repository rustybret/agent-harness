import { rm } from "node:fs/promises"

import { runArbiter } from "./arbiter"
import { assertExternalMode, writeSelfTestExternalPresence } from "./external-mode"
import { generateRelaySandbox } from "./generator"
import { compareIsolation, snapshotRealRegistry } from "./isolation-proof"
import { seedArbiterEnvelope } from "./seed-envelope"
import { simulateRelayProgrammatically, writeDriverManifest, writeWrongFinalDrop } from "./driver-stub"
import type { SelfTestReport } from "./types"

export async function runSelfTest(): Promise<SelfTestReport> {
  const before = await snapshotRealRegistry()
  const sandbox = await generateRelaySandbox()
  await writeSelfTestExternalPresence(sandbox)
  await assertExternalMode(sandbox)
  const manifestPath = await writeDriverManifest(sandbox)

  const seed = await seedArbiterEnvelope(sandbox)
  await simulateRelayProgrammatically(sandbox, seed)
  const correct = await runArbiter(sandbox, { timeoutMinutes: 0.01, pollMs: 25 })

  await rm(sandbox.arbiterDropDir, { recursive: true, force: true })
  await writeWrongFinalDrop(sandbox)
  const wrong = await runArbiter(sandbox, { timeoutMinutes: 0.01, pollMs: 25 })

  const after = await snapshotRealRegistry()
  const isolation = compareIsolation(before, after)
  return {
    passed: correct.passed && !wrong.passed && isolation.unchanged,
    sandboxRoot: sandbox.root,
    correct,
    wrong,
    isolation,
    externalPresenceAsserted: true,
    generatedContextPath: manifestPath,
  }
}

if (import.meta.main) {
  const shouldRun = process.argv.includes("--self-test")
  if (!shouldRun) {
    console.error("Usage: bun test-support/e2e/mailbox-cipher-relay/self-test.ts --self-test")
    process.exit(2)
  }
  const report = await runSelfTest()
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.passed ? 0 : 1)
}
