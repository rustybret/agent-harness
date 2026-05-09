import { describe, expect, it } from "bun:test"

import { getLanguageId } from "./language-config"

describe("getLanguageId", () => {
  it("#given a just file extension #when resolving the language id #then returns just", () => {
    const result = getLanguageId(".just")

    expect(result).toBe("just")
  })
})
