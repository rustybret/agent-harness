import { describe, expect, test } from "bun:test"
import { resolveSessionAgent } from "./session-agent-resolver"

function clientReturning(messages: unknown[]) {
  return {
    session: {
      messages: async () => ({ data: messages }),
    },
  } as Parameters<typeof resolveSessionAgent>[0]
}

describe("resolveSessionAgent", () => {
  describe("#given a session that switched agents mid-run", () => {
    test("#then it returns the agent in use now, not the one it started with", async () => {
      // given: the host returns messages oldest-first, so the starting agent comes first
      const client = clientReturning([
        { info: { role: "user" } },
        { info: { role: "assistant", agent: "explore" } },
        { info: { role: "assistant", agent: "oracle" } },
      ])

      // when
      const agent = await resolveSessionAgent(client, "ses_test")

      // then
      expect(agent).toBe("oracle")
    })
  })

  describe("#given trailing messages that carry no agent", () => {
    test("#then it walks back to the most recent message that names one", async () => {
      // given
      const client = clientReturning([
        { info: { role: "assistant", agent: "plan" } },
        { info: { role: "user" } },
        { info: { role: "system" } },
      ])

      // when
      const agent = await resolveSessionAgent(client, "ses_test")

      // then
      expect(agent).toBe("plan")
    })
  })

  describe("#given the most recent message is a compaction step", () => {
    test("#then it skips it and reports the real operator", async () => {
      // given: the host attributes compaction to a synthetic agent, which is housekeeping rather
      // than the agent driving the session
      const client = clientReturning([
        { info: { role: "assistant", agent: "sisyphus" } },
        { info: { role: "assistant", agent: "compaction" } },
      ])

      // when
      const agent = await resolveSessionAgent(client, "ses_test")

      // then
      expect(agent).toBe("sisyphus")
    })
  })

  describe("#given a compaction message identified only by its parts", () => {
    test("#then it is skipped the same way", async () => {
      // given
      const client = clientReturning([
        { info: { role: "assistant", agent: "atlas" } },
        { info: { role: "assistant", agent: "sisyphus" }, parts: [{ type: "compaction" }] },
      ])

      // when
      const agent = await resolveSessionAgent(client, "ses_test")

      // then
      expect(agent).toBe("atlas")
    })
  })

  describe("#given no message names an agent", () => {
    test("#then it returns undefined", async () => {
      // given
      const client = clientReturning([{ info: { role: "user" } }, { info: { role: "assistant" } }])

      // when
      const agent = await resolveSessionAgent(client, "ses_test")

      // then
      expect(agent).toBeUndefined()
    })
  })

  describe("#given a session with no messages", () => {
    test("#then it returns undefined", async () => {
      // given
      const client = clientReturning([])

      // when
      const agent = await resolveSessionAgent(client, "ses_test")

      // then
      expect(agent).toBeUndefined()
    })
  })

  describe("#given the messages call fails", () => {
    test("#then it returns undefined rather than propagating", async () => {
      // given
      const client = {
        session: {
          messages: async () => {
            throw new Error("API error")
          },
        },
      } as Parameters<typeof resolveSessionAgent>[0]

      // when
      const agent = await resolveSessionAgent(client, "ses_test")

      // then
      expect(agent).toBeUndefined()
    })
  })
})
