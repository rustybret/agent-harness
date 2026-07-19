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

describe("LazyCodex marketplace sync workflow (fork policy)", () => {
  test("fork publish workflow does not sync the Codex marketplace or build the Codex plugin", () => {
    // #given
    // AGENTS.md FORK SCOPE drops Codex marketplace sync entirely: no lazycodex
    // repository push, no aggregate Codex plugin build. The sync script and the
    // Codex plugin build must not appear in the maintained release path.
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const syncsMarketplace = workflow.includes("bun run script/sync-lazycodex-marketplace.ts")
    const buildsCodexPlugin = workflow.includes("bun run --cwd packages/omo-codex/plugin build")
    const hasSyncStep = workflow.includes("name: Sync LazyCodex Codex marketplace")

    // #then
    expect(syncsMarketplace, "fork release must not run the LazyCodex marketplace sync script").toBe(false)
    expect(buildsCodexPlugin, "fork release must not build the aggregate Codex plugin for marketplace sync").toBe(false)
    expect(hasSyncStep, "fork release must not expose a LazyCodex marketplace sync step").toBe(false)
  })

  test("fork publish-main still builds the vendored LSP dists it actually ships", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  release:")

    // #when
    const buildsLspToolsMcp = publishMainJob.includes("bun run build:lsp-tools-mcp")
    const buildsLspDaemon = publishMainJob.includes("bun run build:lsp-daemon")

    // #then
    expect(buildsLspToolsMcp, "publish-main must build the vendored LSP tools MCP dist it ships").toBe(true)
    expect(buildsLspDaemon, "publish-main must build the vendored LSP daemon dist it ships").toBe(true)
  })
})
