import { describe, expect, it } from "bun:test"
import { PROMPT_TIMEOUT_MS } from "./prompt-timeout-context"

describe("prompt timeout context", () => {
  it("#given slow provider prompt processing #when using the default prompt timeout #then it allows five minutes", () => {
    // given
    const fiveMinutesMs = 5 * 60 * 1000

    // when
    const timeoutMs = PROMPT_TIMEOUT_MS

    // then
    expect(timeoutMs).toBe(fiveMinutesMs)
  })
})
