/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)

describe("published LazyCodex smoke workflow (fork policy)", () => {
  test("fork CI omits the published lazycodex-ai registry smoke job", () => {
    // #given
    // This private fork does not publish the lazycodex-ai npm alias or the Codex
    // marketplace bundle (see AGENTS.md FORK SCOPE), so there is no published
    // package to smoke-test from the registry. The upstream published-smoke job
    // is intentionally absent here rather than restored to satisfy a stale test.
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const hasPublishedSmokeJob = workflow.includes("lazycodex-published-smoke:")
    const runsPublishedInstallSmoke = workflow.includes("npx -y lazycodex-ai@latest --dry-run install")
    const runsPublishedDoctorSmoke = workflow.includes("npx -y lazycodex-ai@latest --dry-run doctor")

    // #then
    expect(hasPublishedSmokeJob, "fork CI must not restore the upstream published lazycodex smoke job").toBe(false)
    expect(runsPublishedInstallSmoke, "fork CI must not run a published lazycodex-ai install smoke").toBe(false)
    expect(runsPublishedDoctorSmoke, "fork CI must not run a published lazycodex-ai doctor smoke").toBe(false)
  })

  test("fork CI still runs the maintained root gates that replace it", () => {
    // #given
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const runsRootTestSuite = workflow.includes("run: bun test")
    const runsRootTypecheck = workflow.includes("run: bun run typecheck")
    const runsRootBuild = workflow.includes("run: bun run build")

    // #then
    expect(runsRootTestSuite, "fork CI must keep the root bun test gate").toBe(true)
    expect(runsRootTypecheck, "fork CI must keep the root typecheck gate").toBe(true)
    expect(runsRootBuild, "fork CI must keep the root build gate").toBe(true)
  })
})
