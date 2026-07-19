/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)

describe("LazyCodex release version stamping workflow (fork policy)", () => {
  test("fork publish workflow omits the lazycodex hook-status build and publish steps", () => {
    // #given
    // Upstream stamped Codex hook status messages with the release version inside a
    // "Build Codex plugin components" step feeding a lazycodex-ai publish. This fork
    // does not build or publish the Codex plugin (AGENTS.md FORK SCOPE), so those
    // steps are absent rather than restored just to keep an old assertion alive.
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const buildsCodexPluginComponents = workflow.includes("name: Build Codex plugin components")
    const publishesLazycodexAlias = workflow.includes("name: Publish lazycodex-ai")
    const exportsHookBuildReleaseVersion = workflow.includes("LAZYCODEX_RELEASE_VERSION:")

    // #then
    expect(buildsCodexPluginComponents, "fork publish workflow must not build Codex plugin components").toBe(false)
    expect(publishesLazycodexAlias, "fork publish workflow must not publish the lazycodex-ai alias").toBe(false)
    expect(exportsHookBuildReleaseVersion, "fork publish workflow must not stamp lazycodex hook status messages").toBe(false)
  })

  test("fork publish workflow omits the LazyCodex marketplace sync step", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const syncsLazycodexMarketplace = workflow.includes("name: Sync LazyCodex Codex marketplace")
    const targetsLazycodexRepository = workflow.includes("code-yeongyu/lazycodex")

    // #then
    expect(syncsLazycodexMarketplace, "fork publish workflow must not sync the LazyCodex Codex marketplace").toBe(false)
    expect(targetsLazycodexRepository, "fork publish workflow must not push to the upstream lazycodex repository").toBe(false)
  })
})
