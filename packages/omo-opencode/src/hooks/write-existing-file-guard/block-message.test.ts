import { describe, expect, test } from "bun:test"

import { buildBlockedWriteMessage } from "./tool-execute-before-handler"

describe("buildBlockedWriteMessage", () => {
  test("#given a blocked path #when building the message #then it names the file that was refused", () => {
    // given
    const filePath = "/repo/src/config.ts"

    // when
    const message = buildBlockedWriteMessage(filePath)

    // then
    expect(message).toContain(filePath)
  })

  test("#given a blocked write #when building the message #then it states the file was not modified", () => {
    // given / when
    const message = buildBlockedWriteMessage("/repo/a.ts")

    // then
    expect(message).toContain("the file is unchanged")
  })

  test("#given a blocked write #when building the message #then it names the read-then-write recovery", () => {
    // given / when
    const message = buildBlockedWriteMessage("/repo/a.ts")

    // then
    expect(message).toContain("read /repo/a.ts first, then write")
    expect(message).toContain("a read grants one overwrite")
  })

  test("#given a blocked write #when building the message #then it names the overwrite escape hatch", () => {
    // given / when
    const message = buildBlockedWriteMessage("/repo/a.ts")

    // then
    // The `overwrite` flag is stripped from args before the tool runs and appears in no tool
    // schema, so the error text is the only place it can be discovered.
    expect(message).toContain("overwrite: true")
  })

  test("#given a blocked write #when building the message #then edit is offered for partial changes only", () => {
    // given / when
    const message = buildBlockedWriteMessage("/repo/a.ts")

    // then
    expect(message).toContain("To change part of the file instead, use edit")
  })

  test("#given a blocked write #when building the message #then it does not claim the write is impossible", () => {
    // given / when
    const message = buildBlockedWriteMessage("/repo/a.ts")

    // then
    // The old text ("File already exists. Use edit tool instead.") read as a prohibition on write,
    // which is wrong: the guard is a read-before-overwrite rule with two documented exits.
    expect(message).not.toContain("File already exists")
  })
})
