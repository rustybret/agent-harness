import type { Message, Part, TextPart, ReasoningPart } from "@opencode-ai/sdk"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

export function createProviderQuirksNormalizerHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output

      if (!messages || messages.length === 0) {
        return
      }

      // Find the last user message to get the providerID
      let providerID: string | undefined
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.info.role === "user") {
          providerID = msg.info.model?.providerID
          break
        }
      }

      if (!providerID) {
        return
      }

      if (providerID === "cerebras") {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i]
          if (msg.info.role !== "assistant") continue
          
          // Strip reasoning_content if it exists on the info object
          if ("reasoning_content" in msg.info) {
            delete (msg.info as any).reasoning_content
          }

          if (!msg.parts) continue

          // Filter out reasoning parts
          msg.parts = msg.parts.filter((part) => part.type !== "reasoning")

          // If parts array is empty after filtering, inject a fallback text part
          if (msg.parts.length === 0) {
            const fallbackText: TextPart = {
              id: `${msg.info.id}_fallback_text`,
              sessionID: msg.info.sessionID,
              messageID: msg.info.id,
              type: "text",
              text: "",
              synthetic: true,
            }
            msg.parts.push(fallbackText)
          }
        }
      } else if (providerID === "groq" || providerID === "moonshot") {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i]
          if (msg.info.role !== "assistant" || !msg.parts) continue

          // Check if message contains any tool parts
          const hasToolParts = msg.parts.some((part) => {
            const type = part.type as string
            return type === "tool" || type === "tool_use"
          })

          if (hasToolParts) {
            // Check if it lacks a reasoning part
            const hasReasoning = msg.parts.some((part) => part.type === "reasoning")

            if (!hasReasoning) {
              // Inject reasoning part at the beginning
              const fallbackReasoning: ReasoningPart = {
                id: `${msg.info.id}_fallback_reasoning`,
                sessionID: msg.info.sessionID,
                messageID: msg.info.id,
                type: "reasoning",
                text: "",
                time: { start: Date.now() },
              }
              msg.parts.unshift(fallbackReasoning)
            }
          }
        }
      }
    },
  }
}
