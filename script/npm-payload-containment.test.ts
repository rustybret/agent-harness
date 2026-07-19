/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const rootManifestUrl = new URL("../package.json", import.meta.url)
const publishWorkflowUrl = new URL("../.github/workflows/publish.yml", import.meta.url)

function readRootFiles(): readonly string[] {
  const manifest = JSON.parse(readFileSync(rootManifestUrl, "utf8")) as { readonly files?: readonly string[] }
  return manifest.files ?? []
}

describe("root npm payload containment", () => {
  test("#given root files allowlist #when senpi containment is checked #then senpi plugin payload is not shipped", () => {
    // given
    const files = readRootFiles()

    // when / then
    expect(files).not.toContain("packages/omo-senpi/plugin")
    expect(files.some((entry) => entry.startsWith("packages/omo-senpi/"))).toBe(false)
  })

  test("#given root files allowlist #when hygiene negations are checked #then nested node_modules and retired component residue are excluded", () => {
    // given
    const files = readRootFiles()

    // when / then
    expect(files).toContain("!packages/omo-codex/plugin/node_modules")
    expect(files).toContain("!packages/omo-codex/plugin/**/node_modules")
    expect(files).toContain("!packages/omo-codex/plugin/components/workflow-selector")
  })

  test("#given root files allowlist #when vendored MCP shipping is checked #then each ships its package.json alongside dist", () => {
    // given
    const files = readRootFiles()

    // when / then
    for (const vendoredMcp of ["lsp-tools-mcp", "lsp-daemon", "git-bash-mcp"] as const) {
      expect(files).toContain(`packages/${vendoredMcp}/dist`)
      expect(files).toContain(`packages/${vendoredMcp}/package.json`)
    }
  })
})

describe("fork publish payload containment", () => {
  test("#given fork publish workflow #when a lazycodex files override is checked #then none is present", () => {
    // given
    // The upstream publish workflow rewrote package.json .files into a lazycodex-ai
    // payload. This fork does not publish the lazycodex-ai alias (AGENTS.md FORK
    // SCOPE), so the root files allowlist is the single source of truth and no
    // per-publish override line exists to drift from it.
    const workflow = readFileSync(publishWorkflowUrl, "utf8")

    // when
    const overrideLine = workflow.split("\n").find((line) => line.includes(".files = ["))

    // then
    expect(overrideLine, "fork publish workflow must not rewrite package.json .files for a lazycodex payload").toBeUndefined()
  })

  test("#given fork publish workflow #when npm publish paths are checked #then only the wrapper packages publish", () => {
    // given
    const workflow = readFileSync(publishWorkflowUrl, "utf8")

    // when
    const publishesOpencodeWrapper = workflow.includes("name: Publish oh-my-opencode")
    const publishesOpenagentWrapper = workflow.includes("name: Publish oh-my-openagent")
    const publishesLazycodexAlias = workflow.includes("name: Publish lazycodex-ai")

    // then
    expect(publishesOpencodeWrapper, "fork publish workflow must still publish oh-my-opencode").toBe(true)
    expect(publishesOpenagentWrapper, "fork publish workflow must still publish oh-my-openagent").toBe(true)
    expect(publishesLazycodexAlias, "fork publish workflow must not publish the lazycodex-ai npm alias").toBe(false)
  })
})
