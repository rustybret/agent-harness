import { readFile } from "node:fs/promises"

import { runArbiter } from "./arbiter"
import { assertExternalMode } from "./external-mode"
import { generateRelaySandbox } from "./generator"
import { seedArbiterEnvelope } from "./seed-envelope"
import { runSelfTest } from "./self-test"
import { writeDriverManifest } from "./driver-stub"
import type { RelaySandbox } from "./types"

function usage(): never {
  console.error(`Usage:
  bun test-support/e2e/mailbox-cipher-relay/cli.ts --self-test
  bun test-support/e2e/mailbox-cipher-relay/cli.ts --generate [--root <dir>]
  bun test-support/e2e/mailbox-cipher-relay/cli.ts --assert-external <context.json>
  bun test-support/e2e/mailbox-cipher-relay/cli.ts --seed <context.json>
  bun test-support/e2e/mailbox-cipher-relay/cli.ts --arbiter <context.json>`)
  process.exit(2)
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

async function loadSandbox(filePath: string | undefined): Promise<RelaySandbox> {
  if (filePath === undefined) usage()
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"))
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`sandbox context is not an object: ${filePath}`)
  }
  return parsed as RelaySandbox
}

async function main(): Promise<number> {
  if (process.argv.includes("--self-test")) {
    const report = await runSelfTest()
    console.log(JSON.stringify(report, null, 2))
    return report.passed ? 0 : 1
  }

  if (process.argv.includes("--generate")) {
    const sandbox = await generateRelaySandbox({ root: valueAfter("--root") })
    const manifestPath = await writeDriverManifest(sandbox)
    console.log(JSON.stringify({ contextPath: sandbox.contextPath, manifestPath, sandbox }, null, 2))
    return 0
  }

  if (process.argv.includes("--assert-external")) {
    const sandbox = await loadSandbox(valueAfter("--assert-external"))
    await assertExternalMode(sandbox)
    console.log(JSON.stringify({ external: true, contextPath: sandbox.contextPath }, null, 2))
    return 0
  }

  if (process.argv.includes("--seed")) {
    const sandbox = await loadSandbox(valueAfter("--seed"))
    const seed = await seedArbiterEnvelope(sandbox)
    console.log(JSON.stringify(seed, null, 2))
    return 0
  }

  if (process.argv.includes("--arbiter")) {
    const sandbox = await loadSandbox(valueAfter("--arbiter"))
    const report = await runArbiter(sandbox)
    console.log(JSON.stringify(report, null, 2))
    return report.passed ? 0 : 1
  }

  usage()
}

if (import.meta.main) {
  const exitCode = await main()
  process.exit(exitCode)
}
