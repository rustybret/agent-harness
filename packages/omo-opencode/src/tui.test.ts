/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TuiPluginApi, TuiPluginMeta, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

import {
  queueTuiPreferenceUpdate,
  readTuiPreferencesFileSync,
  resolveOmoCollapsed,
} from "./features/tui-sidebar/tui-preferences"
import tuiModule, { handleTuiPollError, MAILBOX_SLOT_ORDER, OMO_SLOT_ORDER } from "./tui"

type SolidNode = {
  readonly tag: string
  readonly props: Record<string, unknown>
  readonly children: unknown[]
}

type SidebarApiForTest = {
  readonly state: {
    readonly path: {
      readonly directory: string
    }
  }
  readonly theme: {
    readonly current: Record<string, unknown>
  }
  readonly slots: {
    readonly register: (registration: TuiSlotPlugin) => string
  }
  readonly renderer: {
    readonly requestRender: () => void
  }
  readonly lifecycle: {
    readonly signal: AbortSignal
    readonly onDispose: (dispose: () => void) => () => void
  }
}

describe("TUI sidebar polling", () => {
  let tempDir = ""

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "omo-tui-test-"))
  })

  afterEach(() => {
    mock.restore()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("#given the TUI plugin starts without compiled JSX #when it registers sidebar slots #then it falls back to materialize and registers both slots", async () => {
    // given
    const calls: string[] = []
    const disposers: (() => void)[] = []
    const registrations: TuiSlotPlugin[] = []

    mock.module("@opentui/solid", () => ({
      createElement: (tag: string): SolidNode => ({ tag, props: {}, children: [] }),
      insert: (parent: SolidNode, child: unknown): void => {
        parent.children.push(child)
      },
      setProp: (node: SolidNode, name: string, value: unknown): void => {
        node.props[name] = value
      },
    }))

    const api = {
      state: { path: { directory: tempDir } },
      theme: { current: {} },
      slots: {
        register: (nextRegistration: TuiSlotPlugin): string => {
          calls.push("register")
          registrations.push(nextRegistration)
          return "omo-sidebar-slot"
        },
      },
      renderer: {
        requestRender: (): void => {
          calls.push("render")
        },
      },
      lifecycle: {
        signal: new AbortController().signal,
        onDispose: (dispose: () => void): (() => void) => {
          disposers.push(dispose)
          return () => undefined
        },
      },
    } satisfies SidebarApiForTest

    // when
    await tuiModule.tui(api as unknown as TuiPluginApi, undefined, {} as TuiPluginMeta)

    // then
    expect(calls).toEqual(["register", "register", "render"])
    expect(registrations.map((entry) => entry.order)).toEqual([MAILBOX_SLOT_ORDER, OMO_SLOT_ORDER])
    for (const registration of registrations) {
      expect(Object.keys(registration.slots)).toEqual(["sidebar_content"])
      expect(registration.slots.sidebar_content).toBeFunction()
    }
    for (const dispose of disposers) dispose()
  })

  it("#given the TUI plugin starts with compiled JSX available #when it registers sidebar slots #then it mounts the compiled component and registers both slots", async () => {
    // given
    const calls: string[] = []
    const disposers: (() => void)[] = []
    const registrations: TuiSlotPlugin[] = []

    mock.module("@opentui/solid", () => ({
      createElement: (tag: string): SolidNode => ({ tag, props: {}, children: [] }),
      insert: (parent: SolidNode, child: unknown): void => {
        parent.children.push(child)
      },
      setProp: (node: SolidNode, name: string, value: unknown): void => {
        node.props[name] = value
      },
    }))

    const compiledUrl = new URL("./tui-compiled/mailbox-sidebar.js", import.meta.url).href
    mock.module(compiledUrl, () => ({
      MailboxSidebar: () => ({ tag: "compiled-mailbox" }),
      createMailboxSidebarController: () => ({ dispose: () => {} })
    }))

    const api = {
      state: { path: { directory: tempDir } },
      theme: { current: {} },
      slots: {
        register: (nextRegistration: TuiSlotPlugin): string => {
          calls.push("register")
          registrations.push(nextRegistration)
          return "omo-sidebar-slot"
        },
      },
      renderer: {
        requestRender: (): void => {
          calls.push("render")
        },
      },
      lifecycle: {
        signal: new AbortController().signal,
        onDispose: (dispose: () => void): (() => void) => {
          disposers.push(dispose)
          return () => undefined
        },
      },
    } satisfies SidebarApiForTest

    // when
    await tuiModule.tui(api as unknown as TuiPluginApi, undefined, {} as TuiPluginMeta)

    // then
    expect(calls).toEqual(["register", "register", "render"])
    expect(registrations.map((entry) => entry.order)).toEqual([MAILBOX_SLOT_ORDER, OMO_SLOT_ORDER])
    for (const registration of registrations) {
      expect(Object.keys(registration.slots)).toEqual(["sidebar_content"])
      expect(registration.slots.sidebar_content).toBeFunction()
    }
    for (const dispose of disposers) dispose()
  })

  it("#given the mailbox slot order and an external slot at the Magic Context default #when sorted ascending #then the mailbox slot renders first", () => {
    // given
    const MAGIC_CONTEXT_DEFAULT_SLOT_ORDER = 200
    const slots = [
      { id: "magic-context", order: MAGIC_CONTEXT_DEFAULT_SLOT_ORDER },
      { id: "mailbox", order: MAILBOX_SLOT_ORDER },
    ]

    // when
    const sorted = [...slots].sort((left, right) => left.order - right.order)

    // then
    expect(MAILBOX_SLOT_ORDER).toBeLessThan(MAGIC_CONTEXT_DEFAULT_SLOT_ORDER)
    expect(sorted.map((slot) => slot.id)).toEqual(["mailbox", "magic-context"])
  })

  it("#given an unexpected Error during polling #when the poll error handler runs #then the error is logged", () => {
    // given
    const pollError = new TypeError("view derivation failed")
    const reportedErrors: Error[] = []

    // when
    handleTuiPollError(pollError, (error) => {
      reportedErrors.push(error)
    })

    // then
    expect(reportedErrors).toEqual([pollError])
  })

  it("#given a non-Error throw during polling #when the poll error handler runs #then the value is rethrown", () => {
    // given
    const thrownValue = "bad poll state"

    expect(() => handleTuiPollError(thrownValue)).toThrow(thrownValue)
  })
})

describe("mailbox collapse preference round-trip", () => {
  const ENV_KEY = "OPENCODE_TUI_PREFERENCES_FILE"
  let prefsDir = ""
  let previousEnv: string | undefined

  beforeEach(() => {
    previousEnv = process.env[ENV_KEY]
    prefsDir = mkdtempSync(join(tmpdir(), "omo-tui-prefs-"))
    process.env[ENV_KEY] = join(prefsDir, "tui-preferences.jsonc")
  })

  afterEach(() => {
    if (previousEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = previousEnv
    rmSync(prefsDir, { recursive: true, force: true })
  })

  it("#given a collapsed=true write #when re-read from disk #then the collapse state persists", async () => {
    // given
    await queueTuiPreferenceUpdate(["mailbox", "collapsed"], true)

    // when
    const afterTrue = resolveOmoCollapsed(readTuiPreferencesFileSync())

    // then
    expect(afterTrue).toBe(true)

    // given
    await queueTuiPreferenceUpdate(["mailbox", "collapsed"], false)

    // when
    const afterFalse = resolveOmoCollapsed(readTuiPreferencesFileSync())

    // then
    expect(afterFalse).toBe(false)
  })
})
