import { describe, expect, it } from "bun:test"

import { buildSendEnvelope, type SendInput } from "./envelope-builder"

const THIS_PROJECT_ID = "proj-c"

function baseInput(overrides: Partial<SendInput> = {}): SendInput {
  return {
    targetProjectId: "proj-b",
    intent: "quick",
    body: "hello",
    ...overrides,
  }
}

describe("buildSendEnvelope - requested_mode", () => {
  it("threads requested_mode into the built envelope when provided", async () => {
    // given
    const input = baseInput({ requested_mode: "subagent" })

    // when
    const built = await buildSendEnvelope(
      input,
      THIS_PROJECT_ID,
      "/tmp/this-repo",
      "proj-b",
      "Project B",
      "Project C",
    )

    // then
    if ("error" in built) throw new Error("expected a built envelope")
    expect(built.envelope.requested_mode).toBe("subagent")
  })

  it("leaves requested_mode undefined when omitted (legacy shape)", async () => {
    // given
    const input = baseInput()

    // when
    const built = await buildSendEnvelope(
      input,
      THIS_PROJECT_ID,
      "/tmp/this-repo",
      "proj-b",
      "Project B",
      "Project C",
    )

    // then
    if ("error" in built) throw new Error("expected a built envelope")
    expect(built.envelope.requested_mode).toBeUndefined()
  })
})
