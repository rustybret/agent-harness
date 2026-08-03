import { createHash } from "node:crypto"

import {
  dispatchInternalPrompt as defaultDispatchInternalPrompt,
  isInternalPromptDispatchAccepted,
} from "../../../shared/prompt-async-gate"
import type {
  InternalPromptDispatchArgs,
  InternalPromptDispatchResult,
} from "../../../shared/prompt-async-gate"
import type { UnreadMessage } from "../mailbox/types"
import type { SendInput } from "../send-tool/envelope-builder"
import type { SendResult } from "../send-tool/project-message-tool"

const ANSWER_LOCAL_SOURCE = "mailbox-answer-local"
const DEFAULT_ANSWER_TIMEOUT_MS = 10 * 60 * 1000

type AsyncDispatchArgs = Extract<InternalPromptDispatchArgs, { readonly mode: "async" }>
type DispatchClient = AsyncDispatchArgs["client"]

type SessionCreateResult =
  | { readonly data: { readonly id: string }; readonly error?: never }
  | { readonly error: string; readonly data?: never }

export type AnswerWaitResult =
  | { readonly status: "completed"; readonly text: string }
  | { readonly status: "timeout" | "error"; readonly error?: string }

export type AnswerLocalLaneResult =
  | { readonly status: "replied"; readonly replyMessageId: string }
  | { readonly status: "answer-dropped"; readonly reason: "reply-send-failed" }
  | { readonly status: "rolled-back"; readonly downgradeReason: "child-session-failed" }

export interface AnswerLocalStorePort {
  ack(messageId: string): Promise<void>
  unreserve(messageId: string): Promise<void>
}

export interface AnswerLocalClient extends DispatchClient {
  readonly session: NonNullable<DispatchClient["session"]> & {
    readonly create: (input: {
      readonly body: { readonly parentID: string }
      readonly query: { readonly directory: string }
    }) => Promise<SessionCreateResult>
  }
}

export interface AnswerLocalLaneDeps {
  readonly answerHostSessionId?: string
  readonly client: AnswerLocalClient
  readonly directory: string
  readonly dispatchInternalPrompt?: (args: InternalPromptDispatchArgs) => Promise<InternalPromptDispatchResult>
  readonly log?: (message: string, context?: unknown) => void
  readonly parentSessionId: string
  readonly sendReply: (input: SendInput) => Promise<SendResult>
  readonly store: AnswerLocalStorePort
  readonly timeoutMs?: number
  readonly waitForAnswer: (sessionID: string, timeoutMs: number) => Promise<AnswerWaitResult>
}

export interface AnswerLocalLane {
  fulfill(note: UnreadMessage): Promise<AnswerLocalLaneResult>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function answerDedupeKey(sessionID: string, note: UnreadMessage): string {
  const digest = createHash("sha256").update(`${note.messageId}:${note.body}`).digest("hex").slice(0, 16)
  return `${ANSWER_LOCAL_SOURCE}:${sessionID}:${digest}`
}

export function buildAnswerPrompt(note: UnreadMessage): string {
  return [
    "<mailbox-answer-request>",
    `<message-id>${note.messageId}</message-id>`,
    `<from-project>${note.envelope.fromProject}</from-project>`,
    "<contract>",
    "Answer inline. Do not delegate. Do not call project_message. The lane will send your final assistant text as the threaded reply after completion.",
    "</contract>",
    "<question>",
    note.body,
    "</question>",
    "</mailbox-answer-request>",
  ].join("\n")
}

function buildReplyInput(note: UnreadMessage, text: string): SendInput {
  return {
    targetProjectId: note.envelope.fromProjectId,
    intent: "question",
    body: text,
    inReplyToMessageId: note.messageId,
  }
}

async function rollbackChildFailure(
  deps: AnswerLocalLaneDeps,
  note: UnreadMessage,
  reason: string,
): Promise<AnswerLocalLaneResult> {
  deps.log?.("[mailbox-answer-local] child session failed before ack", { messageId: note.messageId, reason })
  await deps.store.unreserve(note.messageId)
  return { status: "rolled-back", downgradeReason: "child-session-failed" }
}

function isSendSuccess(result: SendResult): result is Extract<SendResult, { readonly ok: true }> {
  return "ok" in result && result.ok === true
}

function describeSendFailure(result: Exclude<SendResult, { readonly ok: true }>): string {
  if ("error" in result) return result.error
  return result.reason
}

function dropAckedAnswer(deps: AnswerLocalLaneDeps, note: UnreadMessage, reason: string): AnswerLocalLaneResult {
  deps.log?.("[mailbox-answer-local] reply send failed after ack; dropping answer", {
    messageId: note.messageId,
    reason,
  })
  return { status: "answer-dropped", reason: "reply-send-failed" }
}

export function createAnswerLocalLane(deps: AnswerLocalLaneDeps): AnswerLocalLane {
  const dispatchInternalPrompt = deps.dispatchInternalPrompt ?? defaultDispatchInternalPrompt
  const timeoutMs = deps.timeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS
  const parentID = deps.answerHostSessionId ?? deps.parentSessionId

  return {
    fulfill: async (note: UnreadMessage): Promise<AnswerLocalLaneResult> => {
      let childSessionID: string
      try {
        const createResult = await deps.client.session.create({
          body: { parentID },
          query: { directory: deps.directory },
        })
        if ("error" in createResult) {
          return rollbackChildFailure(deps, note, `create-failed: ${createResult.error}`)
        }
        childSessionID = createResult.data.id

        const dispatchResult = await dispatchInternalPrompt({
          mode: "async",
          client: deps.client,
          sessionID: childSessionID,
          source: ANSWER_LOCAL_SOURCE,
          dedupeKey: answerDedupeKey(childSessionID, note),
          queueBehavior: "defer",
          input: {
            path: { id: childSessionID },
            body: { parts: [{ type: "text", text: buildAnswerPrompt(note) }] },
            query: { directory: deps.directory },
          },
        })
        if (!isInternalPromptDispatchAccepted(dispatchResult)) {
          return rollbackChildFailure(deps, note, `dispatch-${dispatchResult.status}`)
        }

        const answer = await deps.waitForAnswer(childSessionID, timeoutMs)
        if (answer.status !== "completed") {
          return rollbackChildFailure(deps, note, answer.error ?? answer.status)
        }

        await deps.store.ack(note.messageId)

        let sendResult: SendResult
        try {
          sendResult = await deps.sendReply(buildReplyInput(note, answer.text))
        } catch (error) {
          return dropAckedAnswer(deps, note, errorMessage(error))
        }
        if (isSendSuccess(sendResult)) {
          return { status: "replied", replyMessageId: sendResult.messageId }
        }

        // Accepted tradeoff: after the note is acked into processed/, reply build/send
        // failure drops this answer instead of unreserving the original note. Rolling
        // back here would re-run the child session and create a duplicate work loop.
        return dropAckedAnswer(deps, note, describeSendFailure(sendResult))
      } catch (error) {
        return rollbackChildFailure(deps, note, errorMessage(error))
      }
    },
  }
}
