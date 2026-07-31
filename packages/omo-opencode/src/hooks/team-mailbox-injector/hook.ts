import type { TeamModeConfig } from "../../config/schema/team-mode"
import { findResolvedMemberSession } from "../../features/team-mode/member-session-resolution"
import type { PluginContext } from "../../plugin/types"
import type { ExecutorContext } from "../../tools/delegate-task/executor-types"

import { pollAndBuildInjection } from "../../features/team-mode/team-mailbox/poll"
import { log } from "../../shared/logger"

type HookContext = ExecutorContext | PluginContext | Record<string, never>

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
  [key: string]: unknown
}

type TransformMessageInfo = {
  role: string
  sessionID?: string
  [key: string]: unknown
}

type MessageWithParts = {
  info: TransformMessageInfo
  parts: TransformPart[]
}

type TeamMailboxInjectorInput = {
  sessionID?: string
  [key: string]: unknown
}

type TeamMailboxInjectorOutput = {
  messages: MessageWithParts[]
}

export type TeamMailboxInjectorHook = {
  "experimental.chat.messages.transform"?: (
    input: TeamMailboxInjectorInput,
    output: TeamMailboxInjectorOutput,
  ) => Promise<void>
}

function resolveSessionID(
  input: TeamMailboxInjectorInput,
  messages: MessageWithParts[],
): string | undefined {
  if (typeof input.sessionID === "string" && input.sessionID.length > 0) {
    return input.sessionID
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sessionID = messages[index]?.info.sessionID
    if (typeof sessionID === "string" && sessionID.length > 0) {
      return sessionID
    }
  }

  return undefined
}

// The turn marker deduplicates repeated transform invocations WITHIN one turn. Message count alone is
// not a turn identity: the marker is compared against the immediately preceding one, so two CONSECUTIVE
// turns at equal message count are misread as a same-turn retry and the second turn's peer message is
// silently dropped while still counting as handled. Equal-length windows on consecutive turns are
// ordinary once compaction reaches a steady state (summary plus recent tail). Anchoring on the last
// message id keeps the marker stable within a turn and distinct across turns; the count stays as a
// fallback for messages that carry no id.
function buildTurnMarker(sessionID: string, messages: MessageWithParts[]): string {
  const lastMessageID = findLastMessageID(messages)
  if (lastMessageID === undefined) {
    return `${sessionID}#${messages.length}`
  }

  return `${sessionID}#${messages.length}#${lastMessageID}`
}

function findLastMessageID(messages: MessageWithParts[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const id = messages[index]?.info.id
    if (typeof id === "string" && id.length > 0) {
      return id
    }
  }

  return undefined
}

function findLastUserMessageIndex(messages: MessageWithParts[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.info.role === "user") {
      return index
    }
  }

  return -1
}

function createInjectedMessage(
  sessionID: string,
  content: string,
): MessageWithParts {
  return {
    info: {
      role: "user",
      sessionID,
    },
    parts: [{ type: "text", text: content, synthetic: true }],
  }
}

export function createTeamMailboxInjector(
  _ctx: HookContext,
  config: TeamModeConfig,
): TeamMailboxInjectorHook {
  return {
    "experimental.chat.messages.transform": async (
      input,
      output,
    ): Promise<void> => {
      if (!config.enabled || output.messages.length === 0) {
        return
      }

      const sessionID = resolveSessionID(input, output.messages)
      if (sessionID === undefined) {
        return
      }

      try {
        const runtimeMember = await findResolvedMemberSession(sessionID, config, "team mailbox injector")
        if (runtimeMember === null) {
          return
        }

        const turnMarker = buildTurnMarker(sessionID, output.messages)
        const result = await pollAndBuildInjection(
          sessionID,
          runtimeMember.memberName,
          runtimeMember.teamRunId,
          config,
          turnMarker,
        )

        if (!result.injected || result.content === undefined) {
          return
        }

        const lastUserMessageIndex = findLastUserMessageIndex(output.messages)
        const injectedMessage = createInjectedMessage(sessionID, result.content)

        if (lastUserMessageIndex === -1) {
          output.messages.unshift(injectedMessage)
          return
        }

        output.messages.splice(lastUserMessageIndex, 0, injectedMessage)
      } catch (error) {
        log("[team-mailbox-injector] Failed to inject team mailbox messages", {
          error: error instanceof Error ? error.message : String(error),
          sessionID,
        })
      }
    },
  }
}
