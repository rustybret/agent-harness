/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TuiPluginApi, TuiPluginMeta, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

import tuiModule, { MAILBOX_SLOT_ORDER, OMO_SLOT_ORDER } from "./tui"

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

function mockSolidRuntime(): void {
  mock.module("@opentui/solid", () => ({
    createElement: (tag: string): SolidNode => ({ tag, props: {}, children: [] }),
    insert: (parent: SolidNode, child: unknown): void => {
      parent.children.push(child)
    },
    setProp: (node: SolidNode, name: string, value: unknown): void => {
      node.props[name] = value
    },
  }))
}

function makeSidebarApi(
  tempDir: string,
  calls: string[],
  registrations: TuiSlotPlugin[],
  disposers: (() => void)[],
): SidebarApiForTest {
  return {
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
}

function expectSidebarSlots(calls: string[], registrations: TuiSlotPlugin[]): void {
  expect(calls).toEqual(["register", "register", "render"])
  expect(registrations.map((entry) => entry.order)).toEqual([MAILBOX_SLOT_ORDER, OMO_SLOT_ORDER])
  for (const registration of registrations) {
    expect(Object.keys(registration.slots)).toEqual(["sidebar_content"])
    expect(registration.slots.sidebar_content).toBeFunction()
  }
}

describe("TUI sidebar slot registration", () => {
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
    mockSolidRuntime()
    const api = makeSidebarApi(tempDir, calls, registrations, disposers)

    // when
    await tuiModule.tui(api as unknown as TuiPluginApi, undefined, {} as TuiPluginMeta)

    // then
    expectSidebarSlots(calls, registrations)
    for (const dispose of disposers) dispose()
  })

  it("#given the TUI plugin starts with compiled JSX available #when it registers sidebar slots #then it mounts the compiled component and registers both slots", async () => {
    // given
    const calls: string[] = []
    const disposers: (() => void)[] = []
    const registrations: TuiSlotPlugin[] = []
    mockSolidRuntime()

    const compiledUrl = new URL("./tui-compiled/mailbox-sidebar.js", import.meta.url).href
    mock.module(compiledUrl, () => ({
      MailboxSidebar: () => ({ tag: "compiled-mailbox" }),
      createMailboxSidebarController: () => ({ dispose: () => {} }),
    }))

    const api = makeSidebarApi(tempDir, calls, registrations, disposers)

    // when
    await tuiModule.tui(api as unknown as TuiPluginApi, undefined, {} as TuiPluginMeta)

    // then
    expectSidebarSlots(calls, registrations)
    for (const dispose of disposers) dispose()
  })
})
