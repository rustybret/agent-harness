import { describe, expect, it } from "bun:test"
import type { BaseRenderable } from "@opentui/core"
import { createElement, insert, setProp, testRender } from "@opentui/solid"

describe("OpenTUI Solid runtime", () => {
  it("#given the real @opentui/solid runtime #when legacy materialize operations create a box with a text child #then they build a renderable node tree", async () => {
    // given
    let rootNode: BaseRenderable | undefined
    let textNode: BaseRenderable | undefined

    // when
    const setup = await testRender(
      () => {
        const root = createElement("box")
        setProp(root, "id", "legacy-root")
        setProp(root, "flexDirection", "column")

        const text = createElement("text")
        setProp(text, "id", "legacy-text")
        insert(text, "hello")
        insert(root, text)

        rootNode = root
        textNode = text

        return root
      },
      { width: 20, height: 5 },
    )
    await setup.renderOnce()

    // then
    if (rootNode === undefined || textNode === undefined) {
      throw new Error("@opentui/solid did not create the expected renderables")
    }
    expect(rootNode.constructor.name).toBe("BoxRenderable")
    expect(rootNode.id).toBe("legacy-root")
    expect(textNode.constructor.name).toBe("TextRenderable")
    expect(textNode.id).toBe("legacy-text")
    expect(textNode.parent).toBe(rootNode)
    expect(rootNode.getChildren()).toEqual([textNode])
    expect(setup.captureCharFrame()).toContain("hello")
  })
})
