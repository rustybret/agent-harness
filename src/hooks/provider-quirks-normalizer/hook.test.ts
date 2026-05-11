declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: <T>(value: T) => {
  toBe(expected: T): void
  toEqual(expected: unknown): void
  toHaveLength(expected: number): void
}

import { createProviderQuirksNormalizerHook } from "./hook"

type TestPart = {
  type: string
  text?: string
}

type TestMessage = {
  info: { role: "assistant" | "user"; model?: { providerID: string } }
  parts: TestPart[]
}

async function runTransform(messages: TestMessage[]): Promise<void> {
  const hook = createProviderQuirksNormalizerHook()
  const transform = hook["experimental.chat.messages.transform"]

  if (!transform) {
    throw new Error("missing provider quirks normalizer transform")
  }

  await transform({}, { messages: messages as never })
}

describe("createProviderQuirksNormalizerHook", () => {
  it("Cerebras strips reasoning parts", async () => {
    //#given
    const messages = [
      {
        info: { role: "user", model: { providerID: "cerebras" } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "response" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "response" }])
  })

  it("Cerebras injects text when all parts stripped", async () => {
    //#given
    const messages = [
      {
        info: { role: "user", model: { providerID: "cerebras" } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "reasoning", text: "thinking" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toHaveLength(1)
    expect(messages[1]?.parts[0]?.type).toBe("text")
    expect(messages[1]?.parts[0]?.text).toBe("")
  })

  it("Groq injects reasoning for tool-use messages", async () => {
    //#given
    const messages = [
      {
        info: { role: "user", model: { providerID: "groq" } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_use" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toHaveLength(2)
    expect(messages[1]?.parts[0]?.type).toBe("reasoning")
    expect((messages[1]?.parts[0] as TestPart)?.text).toBe("")
    expect(messages[1]?.parts[1]?.type).toBe("tool_use")
  })

  it("Moonshot injects reasoning for tool-use messages", async () => {
    //#given
    const messages = [
      {
        info: { role: "user", model: { providerID: "moonshot" } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_use" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toHaveLength(2)
    expect(messages[1]?.parts[0]?.type).toBe("reasoning")
    expect((messages[1]?.parts[0] as TestPart)?.text).toBe("")
    expect(messages[1]?.parts[1]?.type).toBe("tool_use")
  })

  it("Groq does NOT inject when reasoning already present", async () => {
    //#given
    const messages = [
      {
        info: { role: "user", model: { providerID: "groq" } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "tool_use" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "tool_use" },
    ])
  })

  it("Anthropic passthrough", async () => {
    //#given
    const messages = [
      {
        info: { role: "user", model: { providerID: "anthropic" } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "tool_use" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "tool_use" },
    ])
  })

  it("OpenAI passthrough", async () => {
    //#given
    const messages = [
      {
        info: { role: "user", model: { providerID: "openai" } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "tool_use" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "tool_use" },
    ])
  })

  it("No providerID passthrough", async () => {
    //#given
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "tool_use" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "tool_use" },
    ])
  })

  it("Non-tool assistant messages on Groq are untouched", async () => {
    //#given
    const messages = [
      {
        info: { role: "user", model: { providerID: "groq" } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "response" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "response" }])
  })
})
