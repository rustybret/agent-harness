/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)
const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const workflowsDir = new URL("../.github/workflows/", import.meta.url)
const pinnedBunVersion = 'bun-version: "1.3.12"'
const workflowPaths = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => new URL(name, workflowsDir))

const workflowChecks = [
  {
    path: ciWorkflowPath,
    testRuns: [
      "run: bun test",
      "run: bun test packages/omo-opencode/src/shared/dist-bundle-bun-globals.test.ts",
    ],
  },
  {
    path: publishWorkflowPath,
    testRuns: ["run: bun test"],
  },
]

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

function sliceWorkflowSectionToEnd(workflow: string, startMarker: string): string {
  const start = workflow.indexOf(startMarker)
  if (start < 0) {
    throw new Error(`missing workflow section starting at ${startMarker}`)
  }
  return workflow.slice(start)
}

function normalizeWorkflowText(workflow: string): string {
  return workflow.replace(/\r\n/g, "\n")
}

function expectBunSetupBeforeLspToolsBuild(workflowSection: string, label: string): void {
  const bunSetupIndex = workflowSection.indexOf("uses: oven-sh/setup-bun@v2")
  const lspBuildIndex = workflowSection.indexOf("name: Build vendored lsp-tools-mcp package")

  expect(bunSetupIndex, `${label} must setup Bun`).toBeGreaterThanOrEqual(0)
  expect(lspBuildIndex, `${label} must build lsp-tools-mcp`).toBeGreaterThanOrEqual(0)
  expect(bunSetupIndex, `${label} must setup Bun before lsp-tools-mcp build`).toBeLessThan(lspBuildIndex)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readPackageScript(scriptName: string): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  if (!isRecord(parsed)) throw new Error("package.json must be an object")
  const scripts = parsed["scripts"]
  if (!isRecord(scripts)) throw new Error("package.json scripts must be an object")
  const script = scripts[scriptName]
  if (typeof script !== "string") throw new Error(`package.json scripts.${scriptName} must be a string`)
  return script
}

describe("test workflows", () => {
  test("use pure bun test for workflows", () => {
    for (const workflowCheck of workflowChecks) {
      // #given
      const workflow = readFileSync(workflowCheck.path, "utf8")

      for (const testRun of workflowCheck.testRuns) {
        expect(workflow).toContain(testRun)
      }
    }
  })

  test("prepares vendored lsp-tools-mcp before publish workflow tests and typecheck", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const testJob = sliceWorkflowSection(workflow, "  test:", "  typecheck:")
    const typecheckJob = sliceWorkflowSection(workflow, "  typecheck:", "  preflight-trust:")

    // #when
    const testHasNodeSetup = testJob.includes('node-version: "24"')
    const testBuildsLspToolsMcp = testJob.includes("name: Build vendored lsp-tools-mcp package") &&
      testJob.includes("working-directory: packages/lsp-tools-mcp")

    const typecheckHasNodeSetup = typecheckJob.includes('node-version: "24"')
    const typecheckBuildsLspToolsMcp = typecheckJob.includes("name: Build vendored lsp-tools-mcp package") &&
      typecheckJob.includes("working-directory: packages/lsp-tools-mcp")

    // #then
    expect(testHasNodeSetup, "publish test job must setup Node for MCP package builds").toBe(true)
    expect(testBuildsLspToolsMcp, "publish test job must build lsp-tools-mcp before bun test").toBe(true)
    expect(typecheckHasNodeSetup, "publish typecheck job must setup Node for MCP package builds").toBe(true)
    expect(typecheckBuildsLspToolsMcp, "publish typecheck job must build lsp-tools-mcp before bun run typecheck").toBe(true)
  })

  test("builds publish-main directly from the maintained release jobs", () => {
    // #given
    // AGENTS.md FORK SCOPE / Direct Deployment: the fork publishes directly rather
    // than through a source-pinned redispatch, and does not build the embedded
    // Codex installer for release. publish-main gates on the maintained jobs and
    // builds only the vendored LSP dists it actually ships plus the main bundle.
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  release:")

    // #when
    const gatesOnMaintainedJobs = publishMainJob.includes(
      "needs: [test, typecheck, preflight-trust, release-metadata, prepare-release-state]",
    )
    const buildsMainPackage = publishMainJob.includes(
      "bun run build:lsp-tools-mcp && bun run build:lsp-daemon && bun run build",
    )
    const regeneratesCodexInstaller = publishMainJob.includes("bun run build:codex-install")
    const checksOutPreparedReleaseRef = publishMainJob.includes("ref: ${{ needs.prepare-release-state.outputs.release_sha }}")

    // #then
    expect(gatesOnMaintainedJobs, "publish-main must gate on the fork's maintained release jobs").toBe(true)
    expect(buildsMainPackage, "publish-main must build the vendored LSP dists and the main bundle before publishing").toBe(true)
    expect(regeneratesCodexInstaller, "publish-main must not regenerate the embedded Codex installer this fork does not ship").toBe(false)
    expect(checksOutPreparedReleaseRef, "publish-main must not check out a separately dispatched prepared-source ref").toBe(false)
  })

  test("publishes directly without a source-pinned provenance redispatch phase", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const exposesPreparedSourceInput = workflow.includes("prepared_release_sha:")
    const hasDispatchJob = workflow.includes("dispatch-provenance-safe-publish:")
    const redispatchesPinnedTagRun = workflow.includes('gh workflow run publish.yml --ref "v${VERSION}"')

    // #then
    expect(exposesPreparedSourceInput, "fork publish workflow must not expose a prepared-source dispatch input").toBe(false)
    expect(hasDispatchJob, "fork publish workflow must not run a provenance-safe redispatch job").toBe(false)
    expect(redispatchesPinnedTagRun, "fork publish workflow must not redispatch itself from a pinned tag").toBe(false)
  })

  test("omits the Codex compatibility gate from the publish workflow", () => {
    // #given
    // AGENTS.md FORK SCOPE excludes Codex from active CI/publish pipelines, so the
    // publish workflow has no codex-compatibility job and no publish job gates on
    // one. The maintained test/typecheck gates guard publish instead.
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  release:")

    // #when
    const hasCodexMatrixJob = workflow.includes("codex-compatibility:")
    const anyJobNeedsCodex = workflow.includes("needs.codex-compatibility.result")
    const publishMainNeedsTestAndTypecheck =
      publishMainJob.includes("needs.test.result == 'success'") &&
      publishMainJob.includes("needs.typecheck.result == 'success'")

    // #then
    expect(hasCodexMatrixJob, "fork publish workflow must not expose a Codex compatibility job").toBe(false)
    expect(anyJobNeedsCodex, "no fork publish job may gate on Codex compatibility").toBe(false)
    expect(publishMainNeedsTestAndTypecheck, "publish-main must still wait for the maintained test and typecheck gates").toBe(true)
  })

  test("exercise root checks across linux macos and windows", () => {
    // #given
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const hasCrossOsMatrix = workflow.includes("os: [ubuntu-latest, macos-latest, windows-latest]")
    const hasMatrixRunner = workflow.includes("runs-on: ${{ matrix.os }}")

    // #then
    expect(hasCrossOsMatrix, "CI root checks must cover Linux, macOS, and Windows").toBe(true)
    expect(hasMatrixRunner, "CI root checks must run on the selected matrix OS").toBe(true)
  })

  test("gates CI write jobs on the maintained root checks without serializing build", () => {
    // #given
    // AGENTS.md FORK SCOPE excludes Codex and Senpi from CI, so the fork CI has no
    // codex-compatibility / senpi-compatibility matrix jobs. The write jobs
    // (auto-commit-schema, draft-release) gate on the maintained root checks only,
    // and build stays parallel and read-only.
    const workflow = normalizeWorkflowText(readFileSync(ciWorkflowPath, "utf8"))
    const buildJob = sliceWorkflowSection(workflow, "  build:", "  auto-commit-schema:")
    const autoCommitSchemaJob = sliceWorkflowSection(workflow, "  auto-commit-schema:", "  draft-release:")
    const draftReleaseJob = sliceWorkflowSectionToEnd(workflow, "  draft-release:")

    // #when
    const hasCodexMatrixJob = workflow.includes("codex-compatibility:")
    const hasSenpiMatrixJob = workflow.includes("senpi-compatibility:")
    const runsCodexCommand = workflow.includes("run: bun run test:codex")
    const buildWaitsForChecks = buildJob.includes("needs:")
    const buildHasReadOnlyContentsPermission = buildJob.includes("permissions:\n      contents: read")
    const writeGateNeedsRootChecks = autoCommitSchemaJob.includes("needs: [test, typecheck, build]")
    const draftReleaseNeedsRootChecks = draftReleaseJob.includes("needs: [test, typecheck, build]")

    // #then
    expect(hasCodexMatrixJob, "fork CI must not expose a Codex compatibility matrix job").toBe(false)
    expect(hasSenpiMatrixJob, "fork CI must not expose a Senpi compatibility matrix job").toBe(false)
    expect(runsCodexCommand, "fork CI must not run the Codex test script").toBe(false)
    expect(buildWaitsForChecks, "build has no artifact dependency on test/typecheck and must not serialize CI").toBe(false)
    expect(buildHasReadOnlyContentsPermission, "parallel build must explicitly stay read-only; write actions belong behind the all-check gate").toBe(true)
    expect(writeGateNeedsRootChecks, "schema auto-commit must wait for the maintained root checks and build").toBe(true)
    expect(draftReleaseNeedsRootChecks, "draft release must wait for the maintained root checks and build").toBe(true)
  })

  test("sets up Bun before vendored lsp-tools-mcp builds in publish workflow jobs", () => {
    // #given
    // The maintained publish.yml test and typecheck jobs pre-build the vendored
    // lsp-tools-mcp package, so the Bun-before-build ordering guard still applies
    // to both. (The fork has no codex-compatibility publish job.)
    const publishWorkflow = readFileSync(publishWorkflowPath, "utf8")
    const publishTestJob = sliceWorkflowSection(publishWorkflow, "  test:", "  typecheck:")
    const publishTypecheckJob = sliceWorkflowSection(publishWorkflow, "  typecheck:", "  preflight-trust:")

    // #then
    expectBunSetupBeforeLspToolsBuild(publishTestJob, "publish test job")
    expectBunSetupBeforeLspToolsBuild(publishTypecheckJob, "publish typecheck job")
  })

  test("builds bundled MCP runtimes before Codex compatibility tests", () => {
    // #given
    const codexTestScript = readPackageScript("test:codex")

    // #when
    const requiredPrerequisites = [
      ["generated Codex installer", "bun run build:codex-install"],
      ["Git Bash MCP runtime", "bun run build:git-bash-mcp"],
      ["lsp-tools MCP runtime", "bun run build:lsp-tools-mcp"],
      ["lsp daemon runtime", "bun run build:lsp-daemon"],
      ["vendored lsp-tools package tests", "npm --prefix packages/lsp-tools-mcp test"],
      ["nested Codex plugin npm install", "npm --prefix packages/omo-codex/plugin ci"],
      ["nested Codex plugin build", "bun run --cwd packages/omo-codex/plugin build"],
      ["CodeGraph component tests", "npm --prefix packages/omo-codex/plugin/components/codegraph test"],
      ["third-party notices ship check", "node scripts/check-third-party-notices.mjs --ship"],
      ["Codex compatibility Bun tests", "bun test"],
    ] as const

    // #then
    let previousIndex = -1
    for (const [description, command] of requiredPrerequisites) {
      const index = codexTestScript.indexOf(command)
      expect(index, `test:codex must run ${description}`).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
  })

  test("runs Git Bash installer regressions in Codex compatibility checks", () => {
    // #given
    const packageManifest = readFileSync(new URL("../package.json", import.meta.url), "utf8")

    // #when
    const codexTestScriptRunsGitBashRegressions =
      packageManifest.includes("packages/omo-codex/scripts/install-local-git-bash-preflight.test.mjs") &&
      packageManifest.includes("packages/omo-codex/scripts/install-generated-bundle.test.mjs")

    // #then
    expect(codexTestScriptRunsGitBashRegressions, "test:codex must cover Windows Git Bash preflight and install guidance").toBe(true)
  })

  test("tracks the nested Codex plugin lockfile used by npm ci", () => {
    // #given
    const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8")

    // #when
    const lockfileIsUnignored = gitignore.includes("!packages/omo-codex/plugin/package-lock.json")
    const trackedLockfile = execFileSync("git", ["ls-files", "packages/omo-codex/plugin/package-lock.json"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    }).trim()

    // #then
    expect(lockfileIsUnignored, "the aggregate Codex plugin lockfile must escape the root package-lock ignore").toBe(true)
    expect(trackedLockfile, "npm ci in CI requires the nested Codex plugin package-lock.json to be tracked").toBe("packages/omo-codex/plugin/package-lock.json")
  })

  test("pins every workflow Bun setup to the tested runtime", () => {
    for (const workflowPath of workflowPaths) {
      // #given
      const workflow = readFileSync(workflowPath, "utf8")
      const bunVersionLines = workflow.match(/bun-version: .*/g) ?? []

      // #when
      const unpinnedBunLines = bunVersionLines.filter((line) => line !== pinnedBunVersion)

      // #then
      expect(unpinnedBunLines, `${workflowPath.pathname} must pin Bun to 1.3.12`).toEqual([])
    }
  })

})
