import { afterEach, describe, expect, test } from "bun:test"

import { configureSharedSubunitLogger } from "./logger"
import {
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
} from "./prompt-async-gate"

function captureLogLines(): { lines: Array<{ message: string; data?: unknown }> } {
  const lines: Array<{ message: string; data?: unknown }> = []
  configureSharedSubunitLogger((message, data) => lines.push({ message, data }))
  return { lines }
}

describe("prompt gate failure logging", () => {
  afterEach(() => {
    configureSharedSubunitLogger(undefined)
    releaseAllPromptAsyncReservationsForTesting()
  })

  describe("#given a dispatch that rejects with a non-Error payload", () => {
    test("#when the failure is logged #then the payload is readable rather than [object Object]", async () => {
      // given
      // Observed live: 22 promptAsync failures logged error:"[object Object]", so the record of a
      // failed internal dispatch carried no way to tell a rate limit from a routing bug.
      const { lines } = captureLogLines()
      const client = {
        session: {
          promptAsync: async () => {
            throw { status: 429, body: { message: "rate limited" } }
          },
        },
      }

      // when
      const result = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_error_shape",
        input: { path: { id: "ses_error_shape" }, body: {} },
        source: "test:non-error-rejection",
        settleMs: 0,
        checkStatus: false,
        checkToolState: false,
        queue: false,
      })

      // then
      expect(result.status).toBe("failed")
      const failure = lines.find((line) => line.message.includes("failed"))
      expect(failure).toBeDefined()
      const logged = (failure?.data as { error?: string } | undefined)?.error ?? ""
      expect(logged).not.toBe("[object Object]")
      expect(logged).toContain("429")
      expect(logged).toContain("rate limited")
    })
  })

  describe("#given a dispatch that rejects with an Error", () => {
    test("#when the failure is logged #then name and message are preserved", async () => {
      // given
      const { lines } = captureLogLines()
      const client = {
        session: {
          promptAsync: async () => {
            throw new TypeError("session.messages is not a function")
          },
        },
      }

      // when
      await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID: "ses_error_instance",
        input: { path: { id: "ses_error_instance" }, body: {} },
        source: "test:error-rejection",
        settleMs: 0,
        checkStatus: false,
        checkToolState: false,
        queue: false,
      })

      // then
      const failure = lines.find((line) => line.message.includes("failed"))
      const logged = (failure?.data as { error?: string } | undefined)?.error ?? ""
      expect(logged).toBe("TypeError: session.messages is not a function")
    })
  })
})
