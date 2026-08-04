import { describe, expect, test } from "bun:test"

import { MailboxMessageSchema } from "../envelope/schema"
import type { MailboxMessage } from "../envelope/schema"
import { buildTriagePrompt } from "./template"
import type { TriageConfig } from "./template"

const NOTE_BODY = "Please look at the failing CI job on the auth service and tell me what broke.\n"

function makeNote(
  intent: MailboxMessage["intent"],
  overrides: Partial<MailboxMessage> = {},
): MailboxMessage & { body: string } {
  const envelope = MailboxMessageSchema.parse({
    version: 1,
    messageId: "11111111-1111-4111-8111-111111111111",
    timestamp: 1719500000000,
    correlationId: "22222222-2222-4222-8222-222222222222",
    inReplyToMessageId: null,
    fromProject: "Auth Service (display)",
    toProject: "Gateway (display)",
    fromProjectId: "proj-auth-deadbeef",
    toProjectId: "proj-gw-cafef00d",
    intent,
    priority: 0,
    hopCount: 0,
    hopPath: ["proj-auth-deadbeef"],
    supersedes: null,
    ...overrides,
  })
  return { ...envelope, body: NOTE_BODY }
}

const CONFIG: TriageConfig = { projectDisplayName: "Gateway (display)" }

describe("buildTriagePrompt — question intent", () => {
  test("#given a note with intent=question #when buildTriagePrompt #then answers inline, names sender, no Prometheus, no auto-reply, includes body", () => {
    // given
    const note = makeNote("question")

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    expect(prompt.toLowerCase()).toContain("answer inline")
    expect(prompt).toContain("Auth Service (display)")
    expect(prompt).not.toContain("Prometheus")
    expect(prompt.toLowerCase()).not.toContain("auto-reply: do")
    expect(prompt).toContain(NOTE_BODY.trim())
  })
})

describe("buildTriagePrompt — quick intent", () => {
  test("#given a note with intent=quick #when buildTriagePrompt #then suggests task() with a category, no Prometheus", () => {
    // given
    const note = makeNote("quick")

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    expect(prompt).toContain("task()")
    expect(prompt.toLowerCase()).toContain("category")
    expect(prompt).not.toContain("Prometheus")
  })
})

describe("buildTriagePrompt — impl intent", () => {
  test("#given a note with intent=impl #when buildTriagePrompt #then suggests task() delegation, no Prometheus", () => {
    // given
    const note = makeNote("impl")

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    expect(prompt).toContain("task()")
    expect(prompt).not.toContain("Prometheus")
  })
})

describe("buildTriagePrompt — review intent", () => {
  test("#given a note with intent=review #when buildTriagePrompt #then suggests task() or oracle review, no Prometheus", () => {
    // given
    const note = makeNote("review")

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    const lower = prompt.toLowerCase()
    expect(prompt.includes("task()") || lower.includes("oracle")).toBe(true)
    expect(prompt).not.toContain("Prometheus")
  })
})

describe("buildTriagePrompt — work-loop intent", () => {
  test("#given a note with intent=work-loop #when buildTriagePrompt #then suggests atlas, no Prometheus", () => {
    // given
    const note = makeNote("work-loop")

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    expect(prompt.toLowerCase()).toContain("atlas")
    expect(prompt).not.toContain("Prometheus")
  })
})

describe("buildTriagePrompt — plan intent", () => {
  test("#given a note with intent=plan #when buildTriagePrompt #then plans inline or surfaces to user, never auto-spawns Prometheus", () => {
    // given
    const note = makeNote("plan")

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    const lower = prompt.toLowerCase()
    expect(lower.includes("surface to user") || lower.includes("plan inline")).toBe(true)
    expect(
      lower.includes("do not spawn prometheus") || lower.includes("prometheus is not auto-spawnable"),
    ).toBe(true)
    expect(prompt).not.toContain("spawn Prometheus")
    expect(lower).toContain("do not auto-reply")
  })
})

describe("buildTriagePrompt — cross-batch supersession", () => {
  const SUPERSEDED = "33333333-3333-4333-8333-333333333333"

  test("#given a note superseding an ALREADY DELIVERED message #when buildTriagePrompt #then it opens with a correction naming the superseded id", () => {
    // given
    const note = { ...makeNote("impl", { supersedes: SUPERSEDED }), supersedesDelivered: true }

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    expect(prompt).toContain("CORRECTION")
    expect(prompt).toContain(SUPERSEDED)
    expect(prompt.toLowerCase()).toContain("withdrawn")
    expect(prompt.indexOf("CORRECTION")).toBeLessThan(prompt.indexOf("--- inbound note ---"))
    expect(prompt).toContain(NOTE_BODY.trim())
  })

  test("#given a note superseding a message still unread #when buildTriagePrompt #then no correction banner appears", () => {
    // given
    const note = makeNote("impl", { supersedes: SUPERSEDED })

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    expect(prompt).not.toContain("CORRECTION")
  })

  test("#given an ordinary note #when buildTriagePrompt #then no correction banner appears", () => {
    // given
    const note = makeNote("quick")

    // when
    const prompt = buildTriagePrompt(note, CONFIG)

    // then
    expect(prompt).not.toContain("CORRECTION")
  })
})

describe("buildTriagePrompt — universal footer for every intent", () => {
  const intents: MailboxMessage["intent"][] = ["question", "quick", "impl", "review", "work-loop", "plan"]

  for (const intent of intents) {
    test(`#given intent=${intent} #when buildTriagePrompt #then no-auto-reply clause, project_message hint, body verbatim, sender name`, () => {
      // given
      const note = makeNote(intent)

      // when
      const prompt = buildTriagePrompt(note, CONFIG)

      // then
      expect(prompt.toLowerCase()).toContain("do not auto-reply")
      expect(prompt).toContain("project_message")
      expect(prompt).toContain(NOTE_BODY.trim())
      expect(prompt).toContain("Auth Service (display)")
    })
  }
})
