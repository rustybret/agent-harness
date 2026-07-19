/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"

import { PLATFORMS } from "./build-binaries"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const publishPlatformWorkflowPath = new URL("../.github/workflows/publish-platform.yml", import.meta.url)

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("release and platform publish workflows", () => {
  test("computes release metadata once and does not wire platform-binary publishing into the main release", () => {
    // #given
    // AGENTS.md FORK SCOPE: release workflows do not generate or publish platform
    // binaries. The main publish flow therefore has no publish-platform job, no
    // codex-compatibility gate, and no platform-package verification step; it still
    // resolves release metadata once and feeds it to the wrapper/release jobs.
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const computesReleaseMetadata = workflow.includes("release-metadata:") &&
      workflow.includes("outputs:") &&
      workflow.includes("version: ${{ steps.version.outputs.version }}") &&
      workflow.includes("dist_tag: ${{ steps.version.outputs.dist_tag }}")
    const computesVersionOnce = (workflow.match(/id: version/g) ?? []).length === 1
    const publishMainNeedsWithoutPlatform = workflow.includes(
      "needs: [test, typecheck, preflight-trust, release-metadata, prepare-release-state]",
    )
    const wiresPublishPlatformJob = workflow.includes("publish-platform:") ||
      workflow.includes("uses: ./.github/workflows/publish-platform.yml")
    const gatesOnCodexCompatibility = workflow.includes("codex-compatibility")
    const verifiesPlatformPackages = workflow.includes("name: Verify platform packages are published")
    const releaseUsesMetadata = workflow.includes("VERSION: ${{ needs.release-metadata.outputs.version }}")

    // #then
    expect(computesReleaseMetadata, "release metadata must be a first-class job output").toBe(true)
    expect(computesVersionOnce, "version and dist tag must be computed exactly once").toBe(true)
    expect(publishMainNeedsWithoutPlatform, "publish-main must gate on the fork's maintained jobs only").toBe(true)
    expect(wiresPublishPlatformJob, "fork release must not wire platform-binary publishing into the main flow").toBe(false)
    expect(gatesOnCodexCompatibility, "fork release must not gate on the omitted Codex compatibility job").toBe(false)
    expect(verifiesPlatformPackages, "fork release must not verify platform binaries it never publishes").toBe(false)
    expect(releaseUsesMetadata, "release tail must use the shared release metadata").toBe(true)
  })

  test("fails when a required platform artifact is missing", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    // #when
    const downloadStep = sliceWorkflowSection(
      workflow,
      "      - name: Download artifact",
      "      - name: Extract artifact",
    )
    const downloadsWhenPublishNeeded = downloadStep.includes("if: steps.check.outputs.skip_all != 'true'")
    const suppressesDownloadFailure = downloadStep.includes("continue-on-error: true")

    // #then
    expect(downloadsWhenPublishNeeded, "publish job must download artifacts for packages that still need publishing").toBe(true)
    expect(suppressesDownloadFailure, "missing required artifacts must fail the reusable publish workflow").toBe(false)
  })

  test("publishes openagent platform packages even when legacy opencode publish is unavailable", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    // #when
    const opencodePublishStep = sliceWorkflowSection(
      workflow,
      "      - name: Publish oh-my-opencode-${{ matrix.platform }}",
      "      - name: Publish oh-my-openagent-${{ matrix.platform }}",
    )
    const openagentPublishStep = sliceWorkflowSection(
      workflow,
      "      - name: Publish oh-my-openagent-${{ matrix.platform }}",
      "        timeout-minutes: 15",
    )

    // #then
    expect(opencodePublishStep.includes("continue-on-error: true"), "legacy opencode package publish must not block renamed platform publish").toBe(true)
    expect(openagentPublishStep.includes("if: always() && steps.check.outputs.skip_openagent != 'true' && steps.download.outcome == 'success'"), "renamed platform publish must run after legacy publish failures").toBe(true)
    expect(openagentPublishStep.includes(".bin ="), "renamed internal platform packages must not require public bin metadata").toBe(false)
  })

  test("keeps the platform publish workflow step syntax valid around version updates", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    // #when
    const duplicateVersionStep = workflow.includes(
      "      - name: Update version in package.json\n      - name: Update version in package.json",
    )

    // #then
    expect(duplicateVersionStep, "platform publish workflow must not contain adjacent duplicate step names").toBe(false)
  })

  test("publishes platform launchers without Bun compile", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    // #when
    const buildStep = sliceWorkflowSection(
      workflow,
      "      - name: Build launcher",
      "      - name: Verify darwin launcher",
    )
    const darwinVerifyStep = sliceWorkflowSection(
      workflow,
      "      - name: Verify darwin launcher",
      "      - name: Compress binary",
    )

    // #then
    expect(buildStep).toContain("bun run build:binaries")
    expect(buildStep).toContain("bin/oh-my-opencode.js")
    expect(buildStep).not.toContain("bun build packages/omo-opencode/src/cli/index.ts --compile")
    expect(darwinVerifyStep).toContain("#!/usr/bin/env node")
    expect(darwinVerifyStep).not.toContain("codesign")
  })

  test("regenerates the release lockfile and commits the release-state source before publishing", () => {
    // #given
    // The fork keeps the release-state PR gate: the prepare job stamps versions,
    // regenerates the bun lockfile, and commits `release: v${VERSION}` so npm
    // publish only runs from a merged source-state commit.
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareStep = sliceWorkflowSection(
      workflow,
      "      - name: Prepare and merge release state before publishing",
      "      - name: Write job summary",
    )

    // #when
    const syncVersionIndex = prepareStep.indexOf("node packages/omo-codex/plugin/scripts/sync-version.mjs")
    const lockfileIndex = prepareStep.indexOf("bun install --lockfile-only")

    // #then
    expect(syncVersionIndex, "prepare must stamp the Codex plugin version before regenerating the lockfile").toBeGreaterThanOrEqual(0)
    expect(lockfileIndex, "prepare must regenerate the bun lockfile from the stamped source").toBeGreaterThan(syncVersionIndex)
    expect(prepareStep).toContain("git add package.json packages/oh-my-opencode-*/package.json")
    expect(prepareStep).toContain("bun.lock")
    expect(prepareStep).toContain("git commit -m \"release: v${VERSION}\"")
  })

  test("keeps release finalization in a single job without a separate provenance dispatch", () => {
    // #given
    // AGENTS.md FORK SCOPE / Direct Deployment: this fork publishes directly from
    // the maintained jobs and does not run the upstream two-phase
    // dispatch-provenance-safe-publish redispatch model. The release job stamps,
    // tags, and finalizes in place.
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const releaseJob = workflow.slice(workflow.indexOf("  release:"))

    // #when
    const hasDispatchJob = workflow.includes("dispatch-provenance-safe-publish:")
    const redispatchesTagRun = workflow.includes('gh workflow run publish.yml --ref "v${VERSION}"')
    const releaseCreatesTag = releaseJob.includes("name: Create release tag") &&
      releaseJob.includes('git tag "v${VERSION}"')
    const releaseCreatesGithubRelease = releaseJob.includes("name: Create GitHub release") &&
      releaseJob.includes('gh release create "v${VERSION}"')

    // #then
    expect(hasDispatchJob, "fork release must not run a separate provenance-dispatch job").toBe(false)
    expect(redispatchesTagRun, "fork release must not redispatch publish.yml from a pinned tag").toBe(false)
    expect(releaseCreatesTag, "the release job must create the version tag in place").toBe(true)
    expect(releaseCreatesGithubRelease, "the release job must create the GitHub release in place").toBe(true)
  })

  test("enumerates windows-arm64 consistently across every platform-list surface", () => {
    // #given
    const publishSource = readFileSync(new URL("../script/publish.ts", import.meta.url), "utf8")
    const publishPlatformWorkflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    const publishIdsBlock = publishSource.slice(
      publishSource.indexOf("PLATFORM_PACKAGE_IDS = ["),
      publishSource.indexOf("] as const"),
    )
    const publishIds = [...publishIdsBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]).sort()

    const buildBinariesPlatforms = PLATFORMS.map((entry) => entry.platform).sort()

    const matrixLists = [...publishPlatformWorkflow.matchAll(/^\s*platform: \[([^\]]+)\]/gm)].map((match) =>
      match[1]
        .split(",")
        .map((value) => value.trim())
        .sort(),
    )

    const publishWorkflow = readFileSync(publishWorkflowPath, "utf8")
    const publishYmlLists = [
      ...[...publishWorkflow.matchAll(/PLATFORMS=\(([^)]+)\)/g)].map((match) => match[1]),
      ...[...publishWorkflow.matchAll(/for platform in (darwin-arm64[^\n;]*); do/g)].map((match) => match[1]),
    ].map((list) => list.trim().split(/\s+/).sort())

    // #when / #then
    expect(publishIds, "PLATFORM_PACKAGE_IDS must list windows-arm64").toContain("windows-arm64")
    expect(buildBinariesPlatforms, "build-binaries PLATFORMS must list windows-arm64").toContain("windows-arm64")
    expect(matrixLists.length, "publish-platform.yml must define both build and publish matrices").toBe(2)
    for (const matrixList of matrixLists) {
      expect(matrixList, "every publish-platform matrix must list windows-arm64").toContain("windows-arm64")
      expect(matrixList, "publish-platform matrix must match build-binaries PLATFORMS exactly").toEqual(
        buildBinariesPlatforms,
      )
    }
    expect(publishIds, "PLATFORM_PACKAGE_IDS must match build-binaries PLATFORMS exactly").toEqual(
      buildBinariesPlatforms,
    )
    expect(publishYmlLists.length, "publish.yml must enumerate platforms in its 2 source-state version-bump loops (prepare + release), staying consistent with build-binaries").toBe(2)
    for (const publishYmlList of publishYmlLists) {
      expect(publishYmlList, "every publish.yml platform list must match build-binaries PLATFORMS exactly").toEqual(
        buildBinariesPlatforms,
      )
    }
  })

  test("matches the canonical platform set in optionalDependencies and on-disk platform packages", () => {
    // #given
    const rootManifest: { optionalDependencies?: Record<string, string> } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    )
    const buildBinariesPlatforms = PLATFORMS.map((entry) => entry.platform).sort()
    const platformPrefix = "oh-my-opencode-"

    const optionalDependencyPlatforms = Object.keys(rootManifest.optionalDependencies ?? {})
      .filter((name) => name.startsWith(platformPrefix))
      .map((name) => name.slice(platformPrefix.length))
      .sort()

    const onDiskPlatforms = readdirSync(new URL("../packages/", import.meta.url))
      .filter((name) => name.startsWith(platformPrefix))
      .map((name) => name.slice(platformPrefix.length))
      .sort()

    // #when / #then
    expect(
      optionalDependencyPlatforms,
      "root optionalDependencies must list every canonical platform package",
    ).toEqual(buildBinariesPlatforms)
    expect(
      onDiskPlatforms,
      "packages/ must contain a directory for every canonical platform package",
    ).toEqual(buildBinariesPlatforms)
  })
})
