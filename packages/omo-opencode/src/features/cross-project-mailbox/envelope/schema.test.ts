import { Buffer } from "node:buffer"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, test } from "bun:test"

import {
  MAILBOX_MODES,
  MAX_BODY_BYTES,
  MailboxMessageSchema,
  parseEnvelope,
  serializeEnvelope,
} from "./schema"
import type { MailboxMessage, MailboxMode } from "./schema"

function makeEnvelope(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return MailboxMessageSchema.parse({
    version: 2,
    messageId: "11111111-1111-4111-8111-111111111111",
    timestamp: 1719500000000,
    correlationId: "22222222-2222-4222-8222-222222222222",
    inReplyToMessageId: null,
    fromProject: "Project A (display)",
    toProject: "Project B (display)",
    fromProjectId: "proj-a-deadbeef",
    toProjectId: "proj-b-cafef00d",
    intent: "impl",
    priority: 0,
    hopCount: 0,
    hopPath: ["proj-a-deadbeef"],
    supersedes: null,
    ...overrides,
  })
}

describe("serializeEnvelope / parseEnvelope round-trip", () => {
  test("#given valid envelope + body #when serialize then write+read then parse #then deep-equals original", () => {
    // given
    const envelope = makeEnvelope()
    const body = "# Hello\n\nThis is the markdown body.\n"

    // when
    const serialized = serializeEnvelope(envelope, body)
    const dir = mkdtempSync(path.join(tmpdir(), "mailbox-envelope-"))
    const filePath = path.join(dir, "msg.md")
    writeFileSync(filePath, serialized)
    const parsed = parseEnvelope(readFileSync(filePath, "utf8"))

    // then
    expect(parsed.envelope).toEqual(envelope)
    expect(parsed.body).toBe(body)
  })

  test("#given inReplyToMessageId is a uuid #when round-trip #then preserved", () => {
    // given
    const envelope = makeEnvelope({
      inReplyToMessageId: "33333333-3333-4333-8333-333333333333",
      supersedes: "44444444-4444-4444-8444-444444444444",
      hopCount: 2,
      hopPath: ["proj-a-deadbeef", "proj-c-12345678"],
    })
    const body = "reply body"

    // when
    const parsed = parseEnvelope(serializeEnvelope(envelope, body))

    // then
    expect(parsed.envelope).toEqual(envelope)
    expect(parsed.body).toBe(body)
  })

  test("#given body contains a --- line #when round-trip #then body preserved intact", () => {
    // given
    const envelope = makeEnvelope()
    const body = "before\n---\nafter the separator\n"

    // when
    const parsed = parseEnvelope(serializeEnvelope(envelope, body))

    // then
    expect(parsed.body).toBe(body)
    expect(parsed.envelope).toEqual(envelope)
  })
})

describe("body size cap", () => {
  test("#given body of exactly MAX_BODY_BYTES bytes #when serialize #then passes", () => {
    // given
    const envelope = makeEnvelope()
    const body = "a".repeat(MAX_BODY_BYTES)
    expect(Buffer.byteLength(body, "utf8")).toBe(MAX_BODY_BYTES)

    // when / then
    expect(() => serializeEnvelope(envelope, body)).not.toThrow()
  })

  test("#given body of MAX_BODY_BYTES + 1 bytes #when serialize #then throws", () => {
    // given
    const envelope = makeEnvelope()
    const body = "a".repeat(MAX_BODY_BYTES + 1)

    // when / then
    expect(() => serializeEnvelope(envelope, body)).toThrow()
  })
})

describe("schema validation", () => {
  test("#given partial frontmatter missing required fields #when parse #then Zod throws", () => {
    // given
    const fileContent = "---\nmessageId: 11111111-1111-4111-8111-111111111111\n---\nbody"

    // when / then
    expect(() => parseEnvelope(fileContent)).toThrow()
  })

  test("#given content without frontmatter #when parse #then throws", () => {
    // given
    const fileContent = "just a plain body, no frontmatter"

    // when / then
    expect(() => parseEnvelope(fileContent)).toThrow()
  })

  test("#given correlationId omitted #when schema parse #then throws (required in mailbox)", () => {
    // given
    const raw = {
      version: 1,
      messageId: "11111111-1111-4111-8111-111111111111",
      timestamp: 1719500000000,
      inReplyToMessageId: null,
      fromProject: "A",
      toProject: "B",
      fromProjectId: "a-1",
      toProjectId: "b-2",
      intent: "impl",
      hopCount: 0,
      hopPath: [],
      supersedes: null,
    }

    // when / then
    expect(() => MailboxMessageSchema.parse(raw)).toThrow()
  })

  test("#given timestamp as ISO8601 string #when schema parse #then throws (must be numeric epoch-ms)", () => {
    // given
    const raw = {
      version: 1,
      messageId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-06-27T00:00:00.000Z",
      correlationId: "22222222-2222-4222-8222-222222222222",
      inReplyToMessageId: null,
      fromProject: "A",
      toProject: "B",
      fromProjectId: "a-1",
      toProjectId: "b-2",
      intent: "impl",
      hopCount: 0,
      hopPath: [],
      supersedes: null,
    }

    // when / then
    expect(() => MailboxMessageSchema.parse(raw)).toThrow()
  })
})

describe("requested_mode field", () => {
  test("#given MAILBOX_MODES const #then contains the six canonical modes in order", () => {
    // then
    expect(MAILBOX_MODES).toEqual([
      "answer",
      "todo-append",
      "todo-next",
      "subagent",
      "worker-pr",
      "interrupt",
    ])
  })

  test("#given envelope with requested_mode #when serialize then parse #then round-trips", () => {
    // given
    const mode: MailboxMode = "todo-next"
    const envelope = makeEnvelope({ requested_mode: mode })
    const body = "granular injection body"

    // when
    const parsed = parseEnvelope(serializeEnvelope(envelope, body))

    // then
    expect(parsed.envelope.requested_mode).toBe("todo-next")
    expect(parsed.envelope).toEqual(envelope)
    expect(parsed.body).toBe(body)
  })

  test("#given envelope WITHOUT requested_mode #when serialize then parse #then field is undefined (unchanged behavior)", () => {
    // given
    const envelope = makeEnvelope()
    const body = "no mode body"

    // when
    const parsed = parseEnvelope(serializeEnvelope(envelope, body))

    // then
    expect(parsed.envelope.requested_mode).toBeUndefined()
    expect(parsed.envelope).toEqual(envelope)
  })
})

describe("tolerant parse", () => {
  test("#given frontmatter with a version 2 or future version 3 #when parse #then parses cleanly without throwing", () => {
    // given
    const fileContentV1 = [
      "---",
      "version: 1",
      "messageId: 11111111-1111-4111-8111-111111111111",
      "timestamp: 1719500000000",
      "correlationId: 22222222-2222-4222-8222-222222222222",
      "inReplyToMessageId: null",
      "fromProject: A",
      "toProject: B",
      "fromProjectId: a-1",
      "toProjectId: b-2",
      "intent: impl",
      "priority: 0",
      "hopCount: 0",
      "hopPath:",
      "  - a-1",
      "supersedes: null",
      "---",
      "body v1",
    ].join("\n")

    const fileContentV3 = [
      "---",
      "version: 3",
      "messageId: 11111111-1111-4111-8111-111111111111",
      "timestamp: 1719500000000",
      "correlationId: 22222222-2222-4222-8222-222222222222",
      "inReplyToMessageId: null",
      "fromProject: A",
      "toProject: B",
      "fromProjectId: a-1",
      "toProjectId: b-2",
      "intent: impl",
      "priority: 0",
      "hopCount: 0",
      "hopPath:",
      "  - a-1",
      "supersedes: null",
      "future_v3_feature: active",
      "---",
      "body v3",
    ].join("\n")

    // when / then
    const parsedV1 = parseEnvelope(fileContentV1)
    expect(parsedV1.envelope.version).toBe(1)

    const parsedV3 = parseEnvelope(fileContentV3)
    expect(parsedV3.envelope.version).toBe(3)
    expect(parsedV3.body).toBe("body v3")
  })

  test("#given frontmatter with an unknown key #when parse #then does not throw and strips the unknown key", () => {
    // given
    const fileContent = [
      "---",
      "version: 1",
      "messageId: 11111111-1111-4111-8111-111111111111",
      "timestamp: 1719500000000",
      "correlationId: 22222222-2222-4222-8222-222222222222",
      "inReplyToMessageId: null",
      "fromProject: A",
      "toProject: B",
      "fromProjectId: a-1",
      "toProjectId: b-2",
      "intent: impl",
      "priority: 0",
      "hopCount: 0",
      "hopPath:",
      "  - a-1",
      "supersedes: null",
      "future_field_from_newer_sender: some-value",
      "---",
      "body",
    ].join("\n")

    // when / then
    expect(() => parseEnvelope(fileContent)).not.toThrow()
    const parsed = parseEnvelope(fileContent)
    expect(parsed.envelope.intent).toBe("impl")
    expect((parsed.envelope as Record<string, unknown>).future_field_from_newer_sender).toBeUndefined()
    expect(parsed.body).toBe("body")
  })

  test("#given invalid requested_mode enum value #when parse #then coerces to undefined instead of throwing", () => {
    // given
    const fileContent = [
      "---",
      "version: 1",
      "messageId: 11111111-1111-4111-8111-111111111111",
      "timestamp: 1719500000000",
      "correlationId: 22222222-2222-4222-8222-222222222222",
      "inReplyToMessageId: null",
      "fromProject: A",
      "toProject: B",
      "fromProjectId: a-1",
      "toProjectId: b-2",
      "intent: impl",
      "priority: 0",
      "hopCount: 0",
      "hopPath:",
      "  - a-1",
      "supersedes: null",
      "requested_mode: bogus",
      "---",
      "body",
    ].join("\n")

    // when / then
    expect(() => parseEnvelope(fileContent)).not.toThrow()
    const parsed = parseEnvelope(fileContent)
    expect(parsed.envelope.requested_mode).toBeUndefined()
  })

  test("#given still-missing required field #when parse #then throws (tolerance does not weaken required fields)", () => {
    // given
    const fileContent = "---\nmessageId: 11111111-1111-4111-8111-111111111111\nunknown_key: x\n---\nbody"

    // when / then
    expect(() => parseEnvelope(fileContent)).toThrow()
  })
})
