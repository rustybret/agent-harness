import { beforeEach, describe, expect, it } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import {
  ARGUMENT_PARSE_FAILURE_PREAMBLE,
  createJsonErrorRecoveryHook,
  JSON_ERROR_PATTERNS,
  JSON_ERROR_REMINDER,
  JSON_ERROR_TOOL_EXCLUDE_LIST,
} from "./index"

describe("createJsonErrorRecoveryHook", () => {
  let hook: ReturnType<typeof createJsonErrorRecoveryHook>

  type ToolExecuteAfterHandler = NonNullable<
    ReturnType<typeof createJsonErrorRecoveryHook>["tool.execute.after"]
  >
  type ToolExecuteAfterInput = Parameters<ToolExecuteAfterHandler>[0]
  type ToolExecuteAfterOutput = Parameters<ToolExecuteAfterHandler>[1]

  const createMockPluginInput = (): PluginInput => {
    return {
      client: {} as PluginInput["client"],
      directory: "/tmp/test",
    } as PluginInput
  }

  beforeEach(() => {
    hook = createJsonErrorRecoveryHook(createMockPluginInput())
  })

  describe("tool.execute.after", () => {
    const createInput = (tool = "Edit"): ToolExecuteAfterInput => ({
      tool,
      sessionID: "test-session",
      callID: "test-call-id",
    })

    const createOutput = (outputText: string): ToolExecuteAfterOutput => ({
      title: "Tool Error",
      output: outputText,
      metadata: {},
    })

    const createUnknownOutput = (value: unknown): { title: string; output: unknown; metadata: Record<string, unknown> } => ({
      title: "Tool Error",
      output: value,
      metadata: {},
    })

    it("appends reminder when the call's own arguments failed to parse", async () => {
      // given
      // Verbatim shape from opencode, captured from stored sessions.
      const input = createInput()
      const output = createOutput(
        `${ARGUMENT_PARSE_FAILURE_PREAMBLE} Invalid input for tool read: JSON parsing failed: Text: {"filePath": "a.ts", 260}.\nError message: JSON Parse error: Property name must be a string literal`,
      )

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toContain(JSON_ERROR_REMINDER)
    })

    it("appends reminder for an argument parse failure reported as SyntaxError", async () => {
      // given
      const input = createInput()
      const output = createOutput(
        `${ARGUMENT_PARSE_FAILURE_PREAMBLE} Invalid input for tool write: SyntaxError: Unexpected token in JSON at position 10`,
      )

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toContain(JSON_ERROR_REMINDER)
    })

    it("does not append reminder to a successful result whose CONTENT mentions a JSON parse error", async () => {
      // given
      // Observed live: aft_zoom returned source code containing the literal words "json parse
      // error", and the reminder was appended to a call that had succeeded, instructing the caller
      // to abandon a correct tool call.
      const input = createInput("aft_zoom")
      const sourceListing = [
        "packages/omo-opencode/src/tools/delegate-task/sync-prompt-sender.ts:47-51",
        "function isUnexpectedEofError(error: unknown): boolean {",
        '  return lowered.includes("unexpected eof") || lowered.includes("json parse error")',
        "}",
      ].join("\n")
      const output = createOutput(sourceListing)

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe(sourceListing)
    })

    it("does not append reminder when a tool reports a REMOTE json failure it did not cause", async () => {
      // given
      // A page returned HTML where JSON was expected. The arguments were fine, so telling the
      // caller to fix its JSON syntax and retry is wrong advice.
      const input = createInput("playwright_evaluate")
      const remoteFailure =
        "Error: page.evaluate: SyntaxError: Unexpected token '<', \"<br />\" is not valid JSON"
      const output = createOutput(remoteFailure)

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe(remoteFailure)
    })

    it("does not depend on the exclude list to suppress content false positives", async () => {
      // given
      // The exclude list names tools by hardcoded string and cannot cover MCP tools registered at
      // runtime, so gating must hold for a tool the list has never heard of.
      const unknownTools = ["codegraph_codegraph_explore", "comfyui_get_logs", "some_future_mcp_tool"]
      const prose = "The handler logs 'JSON parse error' when the upstream payload is truncated."

      for (const tool of unknownTools) {
        const output = createOutput(prose)

        // when
        await hook["tool.execute.after"](createInput(tool), output)

        // then
        expect(output.output).toBe(prose)
      }
    })

    it("does not append reminder for normal output", async () => {
      // given
      const input = createInput()
      const output = createOutput("Task completed successfully")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe("Task completed successfully")
    })

    it("does not append reminder for empty output", async () => {
      // given
      const input = createInput()
      const output = createOutput("")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe("")
    })

    it("does not append reminder for false positive non-JSON text", async () => {
      // given
      const input = createInput()
      const output = createOutput("Template failed: expected '}' before newline")

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe("Template failed: expected '}' before newline")
    })

    it("does not append reminder for excluded tools", async () => {
      // given
      const input = createInput("Read")
      const argumentError = `${ARGUMENT_PARSE_FAILURE_PREAMBLE} Invalid input for tool read: JSON Parse error: Unexpected EOF`
      const output = createOutput(argumentError)

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(output.output).toBe(argumentError)
    })

    it("does not append reminder for subagent and session-content tools", async () => {
      // given
      const subagentTools = [
        "task",
        "call_omo_agent",
        "background_output",
        "session_read",
        "session_search",
        "session_info",
        "session_list",
        "skill",
        "skill_mcp",
      ]
      const proseMentioningJson = "The oracle re-reviewed. Note: the JSON parse error: unexpected EOF text is spurious content embedded in the returned text, not a real system error."

      for (const tool of subagentTools) {
        const output = createOutput(proseMentioningJson)

        // when
        await hook["tool.execute.after"](createInput(tool), output)

        // then
        expect(output.output).toBe(proseMentioningJson)
      }
    })

    it("does not append reminder when reminder already exists", async () => {
      // given
      const input = createInput()
      const output = createOutput(
        `${ARGUMENT_PARSE_FAILURE_PREAMBLE} Invalid input for tool edit: JSON Parse error: Unexpected EOF\n${JSON_ERROR_REMINDER}`,
      )

      // when
      await hook["tool.execute.after"](input, output)

      // then
      const reminderCount = output.output.split("[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]").length - 1
      expect(reminderCount).toBe(1)
    })

    it("does not append duplicate reminder on repeated execution", async () => {
      // given
      const input = createInput()
      const output = createOutput(
        `${ARGUMENT_PARSE_FAILURE_PREAMBLE} Invalid input for tool edit: JSON Parse error: Unexpected EOF`,
      )

      // when
      await hook["tool.execute.after"](input, output)
      await hook["tool.execute.after"](input, output)

      // then
      const reminderCount = output.output.split("[JSON PARSE ERROR - IMMEDIATE ACTION REQUIRED]").length - 1
      expect(reminderCount).toBe(1)
    })

    it("ignores non-string output values", async () => {
      // given
      const input = createInput()
      const values: unknown[] = [42, null, undefined, { error: "invalid json" }]

      // when
      for (const value of values) {
        const output = createUnknownOutput(value)
        await hook["tool.execute.after"](input, output as ToolExecuteAfterOutput)

        // then
        expect(output.output).toBe(value)
      }
    })
  })

  describe("JSON_ERROR_PATTERNS", () => {
    it("contains known parse error patterns", () => {
      // given
      const output = "JSON parse error: unexpected end of JSON input"

      // when
      const isMatched = JSON_ERROR_PATTERNS.some((pattern) => pattern.test(output))

      // then
      expect(isMatched).toBe(true)
    })

    it("matches the parser message opencode embeds in a malformed argument payload", () => {
      // given
      // Verbatim shape from stored sessions: the outer wrapper says "JSON parsing failed" and the
      // underlying parser message is echoed further in, which is the part these patterns match.
      const output = [
        "Invalid input for tool read: JSON parsing failed: Text: {\"filePath\": \"a.ts\", 260}.",
        "Error message: JSON Parse error: Property name must be a string literal",
      ].join("\n")

      // when
      const isMatched = JSON_ERROR_PATTERNS.some((pattern) => pattern.test(output))

      // then
      expect(isMatched).toBe(true)
    })
  })

  describe("JSON_ERROR_TOOL_EXCLUDE_LIST", () => {
    it("contains content-heavy tools that should be excluded", () => {
      // given
      const expectedExcludedTools: Array<(typeof JSON_ERROR_TOOL_EXCLUDE_LIST)[number]> = [
        "read",
        "bash",
        "webfetch",
        "task",
        "call_omo_agent",
        "background_output",
        "session_read",
        "skill",
      ]

      // when
      const allExpectedToolsIncluded = expectedExcludedTools.every((toolName) =>
        JSON_ERROR_TOOL_EXCLUDE_LIST.includes(toolName)
      )

      // then
      expect(allExpectedToolsIncluded).toBe(true)
    })
  })
})
