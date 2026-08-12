import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const sharedSkillsDir = join(import.meta.dir, "skills")
const fullWorkflowPath = join(sharedSkillsDir, "ulw-plan", "references", "full-workflow.md")
const skillPath = join(sharedSkillsDir, "ulw-plan", "SKILL.md")

describe("ulw-plan Unity subagent routing & dual-layer rule", () => {
  test("#given full-workflow.md #when read #then contains Domain-specialized executor routing (Unity) section", () => {
    // given
    const content = readFileSync(fullWorkflowPath, "utf8")

    // then
    expect(content).toContain("### Domain-specialized executor routing (Unity)")
    expect(content).toContain("unity-script-roslyn")
    expect(content).toContain("unity-scene")
    expect(content).toContain("unity-asset")
    expect(content).toContain("unity-build")
    expect(content).toContain("unity-runtime")
    expect(content).toContain("unity-bridge-bootstrap")
    expect(content).toContain("unity-editor")

    // Annotation pattern assertion
    expect(content).toContain('Recommended task executor category: subagent_type: "unity-script-roslyn"')

    // Dual-layer rule assertions
    expect(content).toContain("aft_search")
    expect(content).toContain("aft_outline")
    expect(content).toContain("aft_zoom")
    expect(content).toContain("aft_callgraph")
    expect(content).toContain("script_create")
    expect(content).toContain("script_edit")
    expect(content).toContain("scene_create")
    expect(content).toContain("material_create")
    expect(content).toContain("Plain-file writes to `.cs`, `.unity`, `.prefab`, or `.meta` content are forbidden in Unity todos")

    // Regression check: producer contract and category vocabulary preserved
    expect(content).toContain("Target 5-8 todos per wave")
    expect(content).toContain("encode every executable item as a column-zero Markdown task row")
  })

  test("#given SKILL.md #when read #then contains Domain-specialized executors invariant bullet", () => {
    // given
    const content = readFileSync(skillPath, "utf8")

    // then
    expect(content).toContain("unity-script-roslyn")
    expect(content).toContain("unity-scene")
    expect(content).toContain("unity-asset")
    expect(content).toContain("unity-build")
    expect(content).toContain("unity-runtime")
    expect(content).toContain("unity-bridge-bootstrap")
    expect(content).toContain("unity-editor")
    expect(content).toContain('subagent_type: "unity-script-roslyn"')
    expect(content).toContain("references/full-workflow.md")

    // Regression check: producer contract preserved
    expect(content).toContain("encode every executable item as a column-zero Markdown task row")
  })
})
