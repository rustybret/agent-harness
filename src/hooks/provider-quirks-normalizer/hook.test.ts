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
  info: {
    role: "assistant" | "user"
    model?: { providerID: string }
    providerID?: string
    [key: string]: any
  }
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
  it("Cerebras strips reasoning parts (nested model.providerID)", async () => {
    //#given
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", model: { providerID: "cerebras" } },
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

  it("Cerebras strips reasoning parts (flat providerID — OpenCode API shape)", async () => {
    //#given
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", providerID: "cerebras" },
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

  it("Cerebras strips reasoning across the full history (not just the latest)", async () => {
    //#given
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "hi" }],
      },
      {
        info: { role: "assistant", providerID: "cerebras" },
        parts: [
          { type: "reasoning", text: "old thinking" },
          { type: "text", text: "old response" },
        ],
      },
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "more" }],
      },
      {
        info: { role: "assistant", providerID: "cerebras" },
        parts: [
          { type: "reasoning", text: "newer thinking" },
          { type: "text", text: "newer response" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "old response" }])
    expect(messages[3]?.parts).toEqual([{ type: "text", text: "newer response" }])
  })

  it("Cerebras injects text when all parts stripped", async () => {
    //#given
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", providerID: "cerebras" },
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
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", providerID: "groq" },
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
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", providerID: "moonshot" },
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
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", providerID: "groq" },
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
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", providerID: "anthropic" },
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
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", providerID: "openai" },
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
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant", providerID: "groq" },
        parts: [{ type: "text", text: "response" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "response" }])
  })

  it("Cerebras strips reasoning_content from info object", async () => {
    //#given
    const messages = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: {
          role: "assistant",
          providerID: "cerebras",
          reasoning_content: "This is the reasoning content that should be stripped",
        },
        parts: [{ type: "text", text: "response" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect("reasoning_content" in messages[1]?.info).toBe(false)
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "response" }])
  })
})
