/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("LazyCodex publish workflow (fork policy)", () => {
  test("fork release omits every lazycodex-ai npm/GitHub publish and marketplace step", () => {
    // #given
    // AGENTS.md FORK SCOPE excludes the lazycodex-ai alias, the Codex marketplace
    // sync to code-yeongyu/lazycodex, and the lazycodex GitHub release. The
    // vestigial publish_lazycodex dispatch input is kept for surface parity but
    // must not be wired to any publish/sync/release step.
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const publishesLazycodexNpm = workflow.includes("name: Publish lazycodex-ai")
    const checksLazycodexNpm = workflow.includes("name: Check if lazycodex-ai already published")
    const smokeTestsLazycodex = workflow.includes("name: Smoke test published lazycodex-ai")
    const syncsMarketplace = workflow.includes("name: Sync LazyCodex Codex marketplace")
    const createsLazycodexRelease = workflow.includes("name: Create LazyCodex GitHub release")
    const requiresLazycodexSyncToken = workflow.includes("LAZYCODEX_SYNC_TOKEN")
    const targetsLazycodexRepo = workflow.includes("code-yeongyu/lazycodex")

    // #then
    expect(publishesLazycodexNpm, "fork release must not publish the lazycodex-ai npm alias").toBe(false)
    expect(checksLazycodexNpm, "fork release must not probe the lazycodex-ai npm registry").toBe(false)
    expect(smokeTestsLazycodex, "fork release must not smoke test a published lazycodex-ai").toBe(false)
    expect(syncsMarketplace, "fork release must not sync the LazyCodex Codex marketplace").toBe(false)
    expect(createsLazycodexRelease, "fork release must not create a LazyCodex GitHub release").toBe(false)
    expect(requiresLazycodexSyncToken, "fork release must not require the cross-repo LazyCodex sync token").toBe(false)
    expect(targetsLazycodexRepo, "fork release must not target the upstream lazycodex repository").toBe(false)
  })

  test("fork preflight trust check verifies only the maintained wrapper packages", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const preflightJob = sliceWorkflowSection(workflow, "  preflight-trust:", "  release-metadata:")

    // #when
    const verifiesWrapperPackages = preflightJob.includes("ALL_PACKAGES=(oh-my-opencode oh-my-openagent)")
    const addsLazycodexToTrustCheck = preflightJob.includes("ALL_PACKAGES+=(lazycodex-ai)")

    // #then
    expect(verifiesWrapperPackages, "preflight must verify the two maintained wrapper packages").toBe(true)
    expect(addsLazycodexToTrustCheck, "preflight must not require a trusted-publisher mapping for lazycodex-ai").toBe(false)
  })

  test("fork publish-main publishes both wrapper packages and restores package.json", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  release:")

    // #when
    const publishesOpencode = publishMainJob.includes("name: Publish oh-my-opencode") &&
      publishMainJob.includes("npm publish --access public --provenance")
    const publishesOpenagent = publishMainJob.includes("name: Publish oh-my-openagent") &&
      publishMainJob.includes('.name = "oh-my-openagent"')
    const restoresPackageJson = publishMainJob.includes("name: Restore package.json") &&
      publishMainJob.includes("git checkout -- package.json")

    // #then
    expect(publishesOpencode, "publish-main must publish oh-my-opencode with provenance").toBe(true)
    expect(publishesOpenagent, "publish-main must publish the renamed oh-my-openagent wrapper").toBe(true)
    expect(restoresPackageJson, "publish-main must restore package.json after the rename publish").toBe(true)
  })

  test("fork release exposes no lazycodex marketplace change-gating output", () => {
    // #given
    // Upstream gated a lazycodex GitHub release + marketplace push on a
    // `lazycodex_changed` payload-diff output. This fork ships no such gate, so
    // that output and its payload-diff plumbing must be entirely absent.
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const releaseMetadataJob = sliceWorkflowSection(workflow, "  release-metadata:", "  prepare-release-state:")

    // #when
    const computesVersion = releaseMetadataJob.includes("version: ${{ steps.version.outputs.version }}") &&
      releaseMetadataJob.includes("dist_tag: ${{ steps.version.outputs.dist_tag }}")
    const exposesLazycodexChangedGate = workflow.includes("lazycodex_changed")
    const diffsMarketplacePayload = workflow.includes("--previous-payload")

    // #then
    expect(computesVersion, "release-metadata must still resolve the release version and dist tag").toBe(true)
    expect(exposesLazycodexChangedGate, "fork release must not gate on a lazycodex marketplace-changed output").toBe(false)
    expect(diffsMarketplacePayload, "fork release must not diff a previous lazycodex marketplace payload").toBe(false)
  })
})
