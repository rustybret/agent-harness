import { describe, expect, test } from "bun:test"

import { isActiveSessionStatus, isTerminalSessionStatus } from "./session-status-classifier"

describe("isActiveSessionStatus", () => {
  describe("#given a known active session status", () => {
    test('#when type is "busy" #then returns true', () => {
      expect(isActiveSessionStatus("busy")).toBe(true)
    })

    test('#when type is "retry" #then returns true', () => {
      expect(isActiveSessionStatus("retry")).toBe(true)
    })

    test('#when type is "running" #then returns true', () => {
      expect(isActiveSessionStatus("running")).toBe(true)
    })
  })

  describe("#given a known terminal session status", () => {
    test('#when type is "idle" #then returns false', () => {
      expect(isActiveSessionStatus("idle")).toBe(false)
    })

    test('#when type is "interrupted" #then returns false', () => {
      expect(isActiveSessionStatus("interrupted")).toBe(false)
    })
  })

  describe("#given an unknown session status", () => {
    test('#when type is an arbitrary unknown string #then returns false', () => {
      expect(isActiveSessionStatus("some-unknown-status")).toBe(false)
    })

    test('#when type is empty string #then returns false', () => {
      expect(isActiveSessionStatus("")).toBe(false)
    })
  })
})

describe("isTerminalSessionStatus", () => {
  test('#when type is "interrupted" #then returns true', () => {
    expect(isTerminalSessionStatus("interrupted")).toBe(true)
  })

  test('#when type is "idle" #then returns false (idle is handled separately)', () => {
    expect(isTerminalSessionStatus("idle")).toBe(false)
  })

  test('#when type is "busy" #then returns false', () => {
    expect(isTerminalSessionStatus("busy")).toBe(false)
  })

  test('#when type is an unknown string #then returns false', () => {
    expect(isTerminalSessionStatus("some-unknown")).toBe(false)
  })
})
