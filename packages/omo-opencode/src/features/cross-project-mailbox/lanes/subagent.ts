import { DEFAULT_CATEGORIES, isPlanFamily } from "../../../tools/delegate-task/constants"
import type { MailboxMessage } from "../envelope/schema"
import { CATEGORY_TIER, withinBudget } from "../permission-tiers"
import type { CanonicalIntent } from "../permission-tiers"

export const INVESTIGATE_THEN_IMPLEMENT_MARKER = "[investigate-then-implement]"

const IMPLEMENT_AGENT = "sisyphus-junior"
const INVESTIGATE_AGENT = "explore"
const FALLBACK_CATEGORIES = ["quick", "unspecified-low"] as const

// The plan pins quick->quick and impl->unspecified-high. The remaining defaults stay
// non-plan-family: question uses quick, while review/work-loop/plan use unspecified-high
// because there is no atlas/work-loop category in DEFAULT_CATEGORIES.
const DEFAULT_CATEGORY_BY_INTENT: Record<MailboxMessage["intent"], string> = {
  question: "quick",
  quick: "quick",
  impl: "unspecified-high",
  review: "unspecified-high",
  "work-loop": "unspecified-high",
  plan: "unspecified-high",
}

export type SubagentLaneNote = {
  readonly envelope: MailboxMessage
  readonly body: string
}

export type DispatchCategoryDecision =
  | { readonly category: string }
  | { readonly downgrade: true; readonly reason: string }

export type SubagentSpawnInput = {
  readonly description: string
  readonly prompt: string
  readonly agent: string
  readonly category?: string
  readonly parentSessionId: string
  readonly parentMessageId: string
}

export type TaskWaitResult =
  | { readonly status: "completed"; readonly result?: string }
  | { readonly status: "failed"; readonly result?: string }

export type SubagentReplySummary =
  | {
      readonly status: "completed"
      readonly category: string
      readonly taskIds: readonly string[]
      readonly resultSummary: string
      readonly evidencePath?: string
    }
  | {
      readonly status: "failed"
      readonly category: string
      readonly taskIds: readonly string[]
      readonly errorSummary: string
      readonly evidencePath?: string
    }

export type SubagentLaneDeps = {
  readonly senderCeiling: CanonicalIntent
  readonly parentSessionId: string
  readonly parentMessageId: string
  readonly spawn: (input: SubagentSpawnInput) => Promise<{ readonly taskId: string }>
  readonly waitForTask: (taskId: string) => Promise<TaskWaitResult>
  readonly sendReply: (note: SubagentLaneNote, summary: SubagentReplySummary) => Promise<void>
  readonly ack: (messageId: string) => Promise<void>
}

export type SubagentLaneResult =
  | {
      readonly status: "dispatched"
      readonly category: string
      readonly firstTaskId: string
      readonly completion: Promise<void>
    }
  | { readonly status: "downgraded"; readonly reason: string }

type CompletionContext = {
  readonly note: SubagentLaneNote
  readonly deps: SubagentLaneDeps
  readonly category: string
  readonly taskIds: string[]
}

function preferredCategory(note: SubagentLaneNote): string {
  return note.envelope.category ?? DEFAULT_CATEGORY_BY_INTENT[note.envelope.intent]
}

function categoryReason(category: string, senderCeiling: CanonicalIntent): string {
  if (isPlanFamily(category)) return "category-plan-family"
  const required = CATEGORY_TIER[category]
  if (required === undefined) return "category-unknown"
  if (!withinBudget(required, senderCeiling)) return "category-over-budget"
  return "category-unavailable"
}

function categoryFits(category: string, senderCeiling: CanonicalIntent): boolean {
  const required = CATEGORY_TIER[category]
  return required !== undefined && DEFAULT_CATEGORIES[category] !== undefined && !isPlanFamily(category) && withinBudget(required, senderCeiling)
}

function fallbackCategory(senderCeiling: CanonicalIntent): string | undefined {
  return FALLBACK_CATEGORIES.find((category) => categoryFits(category, senderCeiling))
}

export function resolveDispatchCategory(note: SubagentLaneNote, senderCeiling: CanonicalIntent): DispatchCategoryDecision {
  const category = preferredCategory(note)
  if (categoryFits(category, senderCeiling)) {
    return { category }
  }

  const fallback = fallbackCategory(senderCeiling)
  if (fallback !== undefined) {
    return { category: fallback }
  }

  return { downgrade: true, reason: categoryReason(category, senderCeiling) }
}

function hasInvestigateThenImplementMarker(body: string): boolean {
  return body.toLowerCase().includes(INVESTIGATE_THEN_IMPLEMENT_MARKER)
}

function description(note: SubagentLaneNote, phase: "investigate" | "implement"): string {
  return `mailbox ${phase} ${note.envelope.messageId.slice(0, 8)}`
}

function implementationPrompt(note: SubagentLaneNote, findings?: string): string {
  return [
    "Fulfill this cross-project mailbox subagent request.",
    note.body,
    findings === undefined ? undefined : `Investigation findings:\n${findings}`,
  ].filter((part): part is string => part !== undefined).join("\n\n")
}

function investigationPrompt(note: SubagentLaneNote): string {
  return [
    "Investigate this cross-project mailbox request and return findings for an implementation subagent.",
    note.body,
  ].join("\n\n")
}

function spawnInput(input: {
  readonly note: SubagentLaneNote
  readonly deps: SubagentLaneDeps
  readonly category: string
  readonly agent: string
  readonly phase: "investigate" | "implement"
  readonly prompt: string
}): SubagentSpawnInput {
  return {
    description: description(input.note, input.phase),
    prompt: input.prompt,
    agent: input.agent,
    category: input.category,
    parentSessionId: input.deps.parentSessionId,
    parentMessageId: input.deps.parentMessageId,
  }
}

function resultText(result: TaskWaitResult, fallback: string): string {
  const text = result.result?.trim()
  return text && text.length > 0 ? text : fallback
}

function extractEvidencePath(text: string): string | undefined {
  return text.match(/(?:^|\s)(\.omo\/evidence\/\S+)/)?.[1]
}

function completedSummary(ctx: CompletionContext, result: TaskWaitResult): SubagentReplySummary {
  const resultSummary = resultText(result, "subagent completed without a text result")
  const evidencePath = extractEvidencePath(resultSummary)
  return {
    status: "completed",
    category: ctx.category,
    taskIds: ctx.taskIds,
    resultSummary,
    ...(evidencePath === undefined ? {} : { evidencePath }),
  }
}

function failedSummary(ctx: CompletionContext, result: TaskWaitResult): SubagentReplySummary {
  const errorSummary = resultText(result, "subagent failed without a text result")
  const evidencePath = extractEvidencePath(errorSummary)
  return {
    status: "failed",
    category: ctx.category,
    taskIds: ctx.taskIds,
    errorSummary,
    ...(evidencePath === undefined ? {} : { evidencePath }),
  }
}

function unexpectedFailure(error: unknown): TaskWaitResult {
  return { status: "failed", result: error instanceof Error ? error.message : String(error) }
}

async function sendReplyForResult(ctx: CompletionContext, result: TaskWaitResult): Promise<void> {
  if (result.status === "completed") {
    await ctx.deps.sendReply(ctx.note, completedSummary(ctx, result))
    return
  }
  await ctx.deps.sendReply(ctx.note, failedSummary(ctx, result))
}

async function completeSingle(ctx: CompletionContext): Promise<void> {
  try {
    const result = await ctx.deps.waitForTask(ctx.taskIds[0] ?? "")
    await sendReplyForResult(ctx, result)
  } catch (error) {
    await sendReplyForResult(ctx, unexpectedFailure(error))
  }
}

async function completePair(ctx: CompletionContext): Promise<void> {
  try {
    const investigation = await ctx.deps.waitForTask(ctx.taskIds[0] ?? "")
    if (investigation.status === "failed") {
      await ctx.deps.sendReply(ctx.note, failedSummary(ctx, investigation))
      return
    }

    const implementation = await ctx.deps.spawn(spawnInput({
      note: ctx.note,
      deps: ctx.deps,
      category: ctx.category,
      agent: IMPLEMENT_AGENT,
      phase: "implement",
      prompt: implementationPrompt(ctx.note, resultText(investigation, "investigation completed without a text result")),
    }))
    ctx.taskIds.push(implementation.taskId)

    const result = await ctx.deps.waitForTask(implementation.taskId)
    await sendReplyForResult(ctx, result)
  } catch (error) {
    await sendReplyForResult(ctx, unexpectedFailure(error))
  }
}

export async function runSubagentLane(note: SubagentLaneNote, deps: SubagentLaneDeps): Promise<SubagentLaneResult> {
  const resolved = resolveDispatchCategory(note, deps.senderCeiling)
  if ("downgrade" in resolved) {
    return { status: "downgraded", reason: resolved.reason }
  }

  const split = hasInvestigateThenImplementMarker(note.body)
  const first = await deps.spawn(spawnInput({
    note,
    deps,
    category: resolved.category,
    agent: split ? INVESTIGATE_AGENT : IMPLEMENT_AGENT,
    phase: split ? "investigate" : "implement",
    prompt: split ? investigationPrompt(note) : implementationPrompt(note),
  }))
  await deps.ack(note.envelope.messageId)

  const ctx: CompletionContext = { note, deps, category: resolved.category, taskIds: [first.taskId] }
  return {
    status: "dispatched",
    category: resolved.category,
    firstTaskId: first.taskId,
    completion: split ? completePair(ctx) : completeSingle(ctx),
  }
}
