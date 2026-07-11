import { describe, expect, it } from "bun:test"

import type { ProjectEntry } from "../registry/types"
import {
  consumeLegacySendersNotice,
  decideLegacySendersNoticeFromContent,
  decideRegistrationToast,
} from "./registration-notice"

function makeEntry(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    projectId: "proj-1",
    repoRoot: "/repo",
    displayName: "proj-1",
    lastSeen: 100,
    ...overrides,
  }
}

describe("decideRegistrationToast", () => {
  it("#given no self entry #when deciding #then does not show", () => {
    // given no entry at all
    // when deciding
    const decision = decideRegistrationToast(undefined, {})

    // then it never shows and carries no marker path
    expect(decision).toEqual({ show: false, markerPath: [] })
  })

  it("#given a self entry without registeredAt #when deciding #then does not show (legacy project)", () => {
    // given a legacy entry never auto-registered
    const entry = makeEntry({ registeredAt: undefined })

    // when deciding
    const decision = decideRegistrationToast(entry, {})

    // then legacy projects never toast
    expect(decision).toEqual({ show: false, markerPath: [] })
  })

  it("#given a fresh registered entry with no marker set #when deciding #then shows with the expected marker path", () => {
    // given a freshly registered entry and an empty prefs object
    const entry = makeEntry({ registeredAt: 1234 })

    // when deciding
    const decision = decideRegistrationToast(entry, {})

    // then it shows and returns the projectId-scoped marker path
    expect(decision).toEqual({
      show: true,
      markerPath: ["mailbox", "registrationNoticeShown", "proj-1"],
    })
  })

  it("#given a fresh registered entry with the marker already true #when deciding #then does not show", () => {
    // given the marker already recorded as shown for this project
    const entry = makeEntry({ registeredAt: 1234 })
    const prefs = {
      "oh-my-openagent": {
        mailbox: { registrationNoticeShown: { "proj-1": true } },
      },
    }

    // when deciding
    const decision = decideRegistrationToast(entry, prefs)

    // then it does not re-show
    expect(decision.show).toBe(false)
  })

  it("#given a marker set true for a different projectId #when deciding #then still shows for this project", () => {
    // given the marker set for a different project only
    const entry = makeEntry({ projectId: "proj-2", registeredAt: 1234 })
    const prefs = {
      "oh-my-openagent": {
        mailbox: { registrationNoticeShown: { "proj-1": true } },
      },
    }

    // when deciding
    const decision = decideRegistrationToast(entry, prefs)

    // then this project still needs its own toast
    expect(decision.show).toBe(true)
    expect(decision.markerPath).toEqual(["mailbox", "registrationNoticeShown", "proj-2"])
  })

  it("#given a malformed prefs shape (marker segment not an object) #when deciding #then treats it as unset and shows", () => {
    // given a prefs file where "mailbox" is a string instead of an object (tolerant read)
    const entry = makeEntry({ registeredAt: 1234 })
    const prefs = { "oh-my-openagent": { mailbox: "not-an-object" } }

    // when deciding
    const decision = decideRegistrationToast(entry, prefs)

    // then the malformed segment is treated as unset, so the toast shows
    expect(decision.show).toBe(true)
  })
})

describe("decideLegacySendersNoticeFromContent", () => {
  it("#given null content (file absent) #when deciding #then does not show", () => {
    // given no flag file
    // when deciding
    const decision = decideLegacySendersNoticeFromContent(null)

    // then nothing shows
    expect(decision).toEqual({ show: false, message: null })
  })

  it("#given valid content with senders #when deciding #then shows with the composed message", () => {
    // given a flag file naming two legacy senders
    const content = JSON.stringify({ senders: ["project-a", "project-b"] })

    // when deciding
    const decision = decideLegacySendersNoticeFromContent(content)

    // then it shows with a message listing both
    expect(decision.show).toBe(true)
    expect(decision.message).toBe(
      "Mailbox: user-level sender grants now apply to all projects: project-a, project-b",
    )
  })

  it("#given content with an empty senders array #when deciding #then does not show", () => {
    // given a flag file with no senders
    const content = JSON.stringify({ senders: [] })

    // when deciding
    const decision = decideLegacySendersNoticeFromContent(content)

    // then nothing shows
    expect(decision.show).toBe(false)
  })

  it("#given corrupted/unparseable JSON content #when deciding #then does not show and does not throw", () => {
    // given corrupted flag content
    const content = "{ not valid json"

    // when deciding
    const decision = decideLegacySendersNoticeFromContent(content)

    // then it tolerantly resolves to not showing
    expect(decision).toEqual({ show: false, message: null })
  })
})

describe("consumeLegacySendersNotice", () => {
  it("#given a missing flag file #when consuming #then no-ops without deleting", async () => {
    // given a readFile that rejects (file absent) and a delete spy
    let deleteCalls = 0
    const result = await consumeLegacySendersNotice("/flag.json", {
      readFile: async () => {
        throw new Error("ENOENT")
      },
      deleteFile: async () => {
        deleteCalls += 1
      },
      hasToastedLegacy: false,
    })

    // then nothing shows and delete is never invoked
    expect(result).toEqual({ show: false, message: null, hasToastedLegacy: false })
    expect(deleteCalls).toBe(0)
  })

  it("#given a valid flag file with senders #when consuming #then shows and deletes the file", async () => {
    // given a valid flag file and a successful delete
    let deletedPath: string | null = null
    const result = await consumeLegacySendersNotice("/flag.json", {
      readFile: async () => JSON.stringify({ senders: ["project-a"] }),
      deleteFile: async (filePath) => {
        deletedPath = filePath
      },
      hasToastedLegacy: false,
    })

    // then it shows the composed message and the flag file was deleted (dedup)
    expect(result.show).toBe(true)
    expect(result.message).toContain("project-a")
    expect(result.hasToastedLegacy).toBe(false)
    expect(deletedPath).toBe("/flag.json")
  })

  it("#given corrupted/unparseable flag JSON #when consuming #then logs, deletes, and never throws", async () => {
    // given corrupted content and a successful delete
    let deleteCalls = 0
    const result = await consumeLegacySendersNotice("/flag.json", {
      readFile: async () => "{ corrupted",
      deleteFile: async () => {
        deleteCalls += 1
      },
      hasToastedLegacy: false,
    })

    // then it does not show, the corrupted file is deleted exactly once, no throw
    expect(result).toEqual({ show: false, message: null, hasToastedLegacy: false })
    expect(deleteCalls).toBe(1)
  })

  it("#given delete failure after a shown notice #when consuming #then flips the in-memory guard to prevent re-toast", async () => {
    // given a valid flag file but a delete that always fails
    const result = await consumeLegacySendersNotice("/flag.json", {
      readFile: async () => JSON.stringify({ senders: ["project-a"] }),
      deleteFile: async () => {
        throw new Error("EPERM")
      },
      hasToastedLegacy: false,
    })

    // then it still shows once, but the guard is now set so the caller stops re-toasting
    expect(result.show).toBe(true)
    expect(result.hasToastedLegacy).toBe(true)
  })

  it("#given hasToastedLegacy already true #when consuming #then never shows again and only retries the delete silently", async () => {
    // given the in-memory guard already set from a prior tick, and a delete that fails again
    let deleteCalls = 0
    const result = await consumeLegacySendersNotice("/flag.json", {
      readFile: async () => JSON.stringify({ senders: ["project-a"] }),
      deleteFile: async () => {
        deleteCalls += 1
        throw new Error("still locked")
      },
      hasToastedLegacy: true,
    })

    // then it never shows, retries the delete once, and swallows the retry failure
    expect(result).toEqual({ show: false, message: null, hasToastedLegacy: true })
    expect(deleteCalls).toBe(1)
  })

  it("#given hasToastedLegacy already true and delete now succeeds #when consuming #then the guard remains true and nothing shows", async () => {
    // given the guard set from a prior failed delete, and this retry succeeding
    let deletedPath: string | null = null
    const result = await consumeLegacySendersNotice("/flag.json", {
      readFile: async () => JSON.stringify({ senders: ["project-a"] }),
      deleteFile: async (filePath) => {
        deletedPath = filePath
      },
      hasToastedLegacy: true,
    })

    // then the flag is finally cleaned up but no second toast fires
    expect(result).toEqual({ show: false, message: null, hasToastedLegacy: true })
    expect(deletedPath).toBe("/flag.json")
  })
})
