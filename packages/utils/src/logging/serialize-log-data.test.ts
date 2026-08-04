import { describe, expect, it } from "bun:test"

import { serializeLogData } from "./serialize-log-data"

function parse(serialized: string | undefined): Record<string, unknown> {
  expect(serialized).toBeDefined()
  return JSON.parse(serialized ?? "{}") as Record<string, unknown>
}

describe("serializeLogData", () => {
  it("#given an Error payload #when serializing #then name message and stack survive", () => {
    // given JSON.stringify alone yields {} because these fields are non-enumerable
    const data = { error: new Error("boom") }

    // when
    const result = parse(serializeLogData(data))

    // then
    const error = result.error as Record<string, unknown>
    expect(error.name).toBe("Error")
    expect(error.message).toBe("boom")
    expect(typeof error.stack).toBe("string")
  })

  it("#given an errno error #when serializing #then the code is preserved alongside the message", () => {
    // given
    const data = { error: Object.assign(new Error("no such file"), { code: "ENOENT" }) }

    // when
    const result = parse(serializeLogData(data))

    // then
    const error = result.error as Record<string, unknown>
    expect(error.code).toBe("ENOENT")
    expect(error.message).toBe("no such file")
  })

  it("#given a wrapped error #when serializing #then the underlying cause is readable", () => {
    // given the shape that logged as {} in the field
    const data = { error: new Error("outer", { cause: new Error("inner") }) }

    // when
    const result = parse(serializeLogData(data))

    // then
    const cause = (result.error as Record<string, unknown>).cause as Record<string, unknown>
    expect(cause.message).toBe("inner")
  })

  it("#given an AggregateError #when serializing #then each aggregated error is readable", () => {
    // given
    const data = { error: new AggregateError([new Error("first"), new Error("second")], "all failed") }

    // when
    const result = parse(serializeLogData(data))

    // then
    const error = result.error as Record<string, unknown>
    expect(error.message).toBe("all failed")
    expect((error.errors as Array<Record<string, unknown>>).map((nested) => nested.message)).toEqual([
      "first",
      "second",
    ])
  })

  it("#given a deeply chained cause #when serializing #then the chain is bounded", () => {
    // given a chain longer than the depth cap
    let error = new Error("root")
    for (let index = 0; index < 8; index += 1) error = new Error(`level-${index}`, { cause: error })

    // when
    const serialized = serializeLogData({ error })

    // then
    let node = parse(serialized).error as Record<string, unknown> | undefined
    let depth = 0
    while (node?.cause !== undefined) {
      node = node.cause as Record<string, unknown>
      depth += 1
    }
    expect(depth).toBeLessThanOrEqual(3)
  })

  it("#given an error stack #when serializing #then the stack is truncated to a few frames", () => {
    // given
    const data = { error: new Error("boom") }

    // when
    const result = parse(serializeLogData(data))

    // then
    const stack = (result.error as Record<string, unknown>).stack as string
    expect(stack.split("\n").length).toBeLessThanOrEqual(5)
  })

  it("#given a plain object payload #when serializing #then output matches JSON.stringify", () => {
    // given
    const data = { qa: true, count: 3, nested: { ok: "yes" } }

    // when
    const result = serializeLogData(data)

    // then
    expect(result).toBe(JSON.stringify(data))
  })

  it("#given a cyclic payload #when serializing #then it reports failure instead of throwing", () => {
    // given
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    // when
    const result = serializeLogData(cyclic)

    // then
    expect(result).toBeUndefined()
  })

  it("#given an error nested inside arrays and objects #when serializing #then it is still readable", () => {
    // given
    const data = { attempts: [{ error: new Error("deep") }] }

    // when
    const result = parse(serializeLogData(data))

    // then
    const attempts = result.attempts as Array<{ error: Record<string, unknown> }>
    expect(attempts[0]?.error.message).toBe("deep")
  })
})
