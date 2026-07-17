/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { createSessionTracker } from "./session-tracker"

describe("external-inject session-tracker", () => {
  it("#given recorded activity #then reports the session as live with its lastActiveAt", () => {
    // given
    let t = 100
    const tracker = createSessionTracker(() => t)
    // when
    tracker.recordActivity("ses_a")
    t = 200
    tracker.recordActivity("ses_b")
    // then
    const live = tracker.liveSessions()
    expect(live).toContainEqual({ id: "ses_a", lastActiveAt: 100 })
    expect(live).toContainEqual({ id: "ses_b", lastActiveAt: 200 })
  })

  it("#given repeated activity #then updates lastActiveAt to the latest", () => {
    let t = 100
    const tracker = createSessionTracker(() => t)
    tracker.recordActivity("ses_a")
    t = 500
    tracker.recordActivity("ses_a")
    expect(tracker.liveSessions()).toEqual([{ id: "ses_a", lastActiveAt: 500 }])
  })

  it("#given remove #then drops the session from the live set", () => {
    const tracker = createSessionTracker(() => 1)
    tracker.recordActivity("ses_a")
    tracker.remove("ses_a")
    expect(tracker.liveSessions()).toEqual([])
  })

  it("#given an empty sessionID #then ignores it", () => {
    const tracker = createSessionTracker(() => 1)
    tracker.recordActivity("")
    expect(tracker.liveSessions()).toEqual([])
  })
})
