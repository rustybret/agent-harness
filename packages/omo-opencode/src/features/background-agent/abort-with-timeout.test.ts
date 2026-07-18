import { describe, expect, mock, test } from "bun:test"

import type { OpencodeClient } from "./opencode-client"
import { abortWithTimeout } from "./abort-with-timeout"

function createClient(abort: (...args: Array<unknown>) => Promise<unknown>): OpencodeClient {
  return {
    session: {
      abort: abort as never,
    },
  } as never
}

describe("abortWithTimeout", () => {
  test("#given abort resolves before timeout #when abortWithTimeout runs #then it returns true", async () => {
    // given
    const abort = mock(async () => ({}))

    // when
    const result = await abortWithTimeout(createClient(abort), "session-1", 10)

    // then
    expect(result).toBe(true)
    expect(abort).toHaveBeenCalledWith({ path: { id: "session-1" } })
  })

  test("#given abort resolves with an SDK error response #when abortWithTimeout runs #then it returns false", async () => {
    // given
    const error = { message: "session not found" }
    const abort = mock(async () => ({ error }))

    // when
    const result = await abortWithTimeout(createClient(abort), "session-error-response", 10)

    // then
    expect(result).toBe(false)
  })

  test("#given abort hangs indefinitely #when abortWithTimeout runs #then it returns false after the timeout", async () => {
    // given
    const abort = mock(() => new Promise<never>(() => {}))

    // when
    const result = await Promise.race([
      abortWithTimeout(createClient(abort), "session-2", 1),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("abort timeout test exceeded wait budget")), 100)
      }),
    ])

    // then
    expect(result).toBe(false)
  })
})
