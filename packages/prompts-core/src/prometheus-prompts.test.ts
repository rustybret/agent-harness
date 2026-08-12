import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { prometheusPromptVariants } from "./index"

describe("prometheus prompt variants", () => {
  test("#given prometheus default prompt #when loaded #then contains pinned signature and Unity subagent routing guidance", () => {
    // given
    const promptPath = "packages/prompts-core/prompts/prometheus/default.md"
    const variant = prometheusPromptVariants.default

    // when
    const content = variant.content
    const fileBytes = readFileSync(promptPath, "utf8")

    // then
    expect(variant.kind).toBe("bundled")
    expect(variant.filePath).toBe(promptPath)
    expect(content).toBe(fileBytes)

    // Preserved pinned signature for dist-bundle test
    expect(content).toContain("Your FIRST action in every planning session is to LOAD the ulw-plan skill")

    // Unity domain subagent routing assertions
    expect(content).toContain("unity-script-roslyn")
    expect(content).toContain("unity-scene")
    expect(content).toContain("unity-asset")
    expect(content).toContain("unity-build")
    expect(content).toContain("unity-runtime")
    expect(content).toContain("unity-bridge-bootstrap")
    expect(content).toContain("unity-editor")

    // Literal routing example annotation assertion
    expect(content).toContain('subagent_type: "unity-script-roslyn"')

    // Dual-layer tooling assertion
    expect(content).toContain("aft_search")
    expect(content).toContain("aft_outline")
    expect(content).toContain("aft_zoom")
    expect(content).toContain("aft_callgraph")
    expect(content).toContain("script_create")
    expect(content).toContain("script_edit")
    expect(content).toContain("scene_create")
  })
})
