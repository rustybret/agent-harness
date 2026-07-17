/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { resolveTargetSession, type LiveSession } from "./session-resolver"

function sessions(...entries: Array<[string, number]>): LiveSession[] {
  return entries.map(([id, lastActiveAt]) => ({ id, lastActiveAt }))
}

describe("external-inject session-resolver", () => {
  describe("#given no sessionID (default active-session mode)", () => {
    it("#then picks the most-recently-active live session", () => {
      // given
      const live = sessions(["ses_old", 100], ["ses_new", 300], ["ses_mid", 200])
      // when
      const result = resolveTargetSession(
        { sessionID: undefined },
        { liveSessions: live, allowDefaultActiveSession: true },
      )
      // then
      expect(result).toEqual({ ok: true, sessionID: "ses_new" })
    })

    it("#then returns no-active-session when nothing is live", () => {
      const result = resolveTargetSession(
        { sessionID: undefined },
        { liveSessions: [], allowDefaultActiveSession: true },
      )
      expect(result).toEqual({ ok: false, reason: "no-active-session" })
    })

    it("#then rejects default addressing when allow_default_active_session is false", () => {
      const live = sessions(["ses_a", 100])
      const result = resolveTargetSession(
        { sessionID: undefined },
        { liveSessions: live, allowDefaultActiveSession: false },
      )
      expect(result).toEqual({ ok: false, reason: "default-addressing-disabled" })
    })
  })

  describe("#given an explicit sessionID", () => {
    it("#then targets it when it is a known live session", () => {
      const live = sessions(["ses_a", 100], ["ses_b", 200])
      const result = resolveTargetSession(
        { sessionID: "ses_a" },
        { liveSessions: live, allowDefaultActiveSession: true },
      )
      expect(result).toEqual({ ok: true, sessionID: "ses_a" })
    })

    it("#then fails closed when the sessionID is unknown/foreign", () => {
      const live = sessions(["ses_a", 100])
      const result = resolveTargetSession(
        { sessionID: "ses_foreign" },
        { liveSessions: live, allowDefaultActiveSession: true },
      )
      expect(result).toEqual({ ok: false, reason: "unknown-session" })
    })

    it("#then honors an explicit sessionID even when default addressing is disabled", () => {
      const live = sessions(["ses_a", 100])
      const result = resolveTargetSession(
        { sessionID: "ses_a" },
        { liveSessions: live, allowDefaultActiveSession: false },
      )
      expect(result).toEqual({ ok: true, sessionID: "ses_a" })
    })
  })
})
