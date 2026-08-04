import { describe, expect, it } from "bun:test"
import { normalizeSDKResponse } from "./normalize-sdk-response"

describe("normalizeSDKResponse", () => {
  it("returns data array when response includes data", () => {
    //#given
    const response = { data: [{ id: "1" }] }

    //#when
    const result = normalizeSDKResponse(response, [] as Array<{ id: string }>)

    //#then
    expect(result).toEqual([{ id: "1" }])
  })

  it("returns fallback array when data is missing", () => {
    //#given
    const response = {}
    const fallback = [{ id: "fallback" }]

    //#when
    const result = normalizeSDKResponse(response, fallback)

    //#then
    expect(result).toEqual(fallback)
  })

  it("returns response array directly when SDK returns plain array", () => {
    //#given
    const response = [{ id: "2" }]

    //#when
    const result = normalizeSDKResponse(response, [] as Array<{ id: string }>)

    //#then
    expect(result).toEqual([{ id: "2" }])
  })

  it("returns response when data missing and preferResponseOnMissingData is true", () => {
    //#given
    const response = { value: "legacy" }

    //#when
    const result = normalizeSDKResponse(response, { value: "fallback" }, { preferResponseOnMissingData: true })

    //#then
    expect(result).toEqual({ value: "legacy" })
  })

  it("returns fallback for null response", () => {
    //#given
    const response = null

    //#when
    const result = normalizeSDKResponse(response, [] as string[])

    //#then
    expect(result).toEqual([])
  })

  it("returns the array fallback when an error envelope resolves where a list was declared", () => {
    //#given the shape opencode returns when session.todo fails
    const response = { data: null, error: { message: "session not found" } }

    //#when a caller that declared a list asks for it permissively
    const result = normalizeSDKResponse(response, [] as Array<{ status: string }>, {
      preferResponseOnMissingData: true,
    })

    //#then it is still a list, so the caller's next .filter cannot throw
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([])
  })

  it("returns the array fallback for a bare object body where a list was declared", () => {
    //#given
    const response = { foo: 1 }

    //#when
    const result = normalizeSDKResponse(response, [] as string[], {
      preferResponseOnMissingData: true,
    })

    //#then
    expect(result).toEqual([])
  })

  it("returns the array fallback for a non-object body where a list was declared", () => {
    //#given
    const response = "not json"

    //#when
    const result = normalizeSDKResponse(response, [] as string[], {
      preferResponseOnMissingData: true,
    })

    //#then
    expect(result).toEqual([])
  })

  it("returns the record fallback when an array resolves where a record was declared", () => {
    //#given
    const response = [1, 2, 3]

    //#when
    const result = normalizeSDKResponse(response, {} as Record<string, unknown>, {
      preferResponseOnMissingData: true,
    })

    //#then
    expect(result).toEqual({})
  })

  it("still returns a bare record body where a record was declared", () => {
    //#given the status-map shape several callers rely on
    const response = { "ses-1": { type: "idle" } }

    //#when
    const result = normalizeSDKResponse(response, {} as Record<string, { type: string }>, {
      preferResponseOnMissingData: true,
    })

    //#then
    expect(result).toEqual({ "ses-1": { type: "idle" } })
  })

  it("returns object fallback for direct data nullish pattern", () => {
    //#given
    const response = { data: undefined as { connected: string[] } | undefined }
    const fallback = { connected: [] }

    //#when
    const result = normalizeSDKResponse(response, fallback)

    //#then
    expect(result).toEqual(fallback)
  })
})
