import { afterEach, describe, expect, it, mock } from "bun:test"

import { _resetLoggerForTesting, _setLoggerForTesting } from "../../shared/logger"

const virtualSolidJsSpecifier = "opentui:runtime-module:" + encodeURIComponent("solid-js")
const virtualOpenTuiSolidSpecifier = "opentui:runtime-module:" + encodeURIComponent("@opentui/solid")

type LogEntry = {
  readonly message: string
  readonly fields: Readonly<Record<string, unknown>> | undefined
}

async function loadFreshHostRuntime(logs: LogEntry[]) {
  _setLoggerForTesting({
    sink: (message: string, fields?: unknown): void => {
      logs.push({ message, fields: fields as Readonly<Record<string, unknown>> | undefined })
    },
  })
  return import(`./host-runtime?case=${Date.now()}-${Math.random()}`)
}

function createOpenTuiSolidRuntime(label: string) {
  return {
    createElement: (tag: string): { readonly label: string; readonly tag: string } => ({ label, tag }),
    insert: (): undefined => undefined,
    setProp: (): undefined => undefined,
  }
}

function createThrowingSolidJsRuntime() {
  return {
    get createSignal(): never {
      throw new Error("missing bare solid-js")
    },
  }
}

function createThrowingOpenTuiSolidRuntime() {
  return {
    get createElement(): never {
      throw new Error("missing bare @opentui/solid createElement")
    },
    get insert(): never {
      throw new Error("missing bare @opentui/solid insert")
    },
    get setProp(): never {
      throw new Error("missing bare @opentui/solid setProp")
    },
  }
}

describe("loadHostSolidRuntime", () => {
  afterEach(() => {
    _resetLoggerForTesting()
    mock.restore()
  })

  it("#given every host virtual registry import fails #when bare modules are available #then bare imports are selected", async () => {
    // given
    const logs: LogEntry[] = []
    const { loadHostSolidRuntime } = await loadFreshHostRuntime(logs)

    // when
    const result = await loadHostSolidRuntime()

    // then
    expect(result.source).toBe("bare-import")
    expect(result.solidJs?.createSignal).toBeFunction()
    expect(result.opentuiSolid?.createElement).toBeFunction()
    expect(result.opentuiSolid?.insert).toBeFunction()
    expect(result.opentuiSolid?.setProp).toBeFunction()
  })

  it("#given host virtual and bare imports fail #when loading the runtime #then it degrades to static rendering", async () => {
    // given
    const logs: LogEntry[] = []
    mock.module("solid-js", createThrowingSolidJsRuntime)
    mock.module("@opentui/solid", createThrowingOpenTuiSolidRuntime)
    const { loadHostSolidRuntime } = await loadFreshHostRuntime(logs)

    // when
    const result = await loadHostSolidRuntime()

    // then
    expect(result).toEqual({ solidJs: null, opentuiSolid: null, source: "none" })
  })

  it("#given the host virtual registry is present #when loading the runtime #then host virtual modules are selected", async () => {
    // given
    const logs: LogEntry[] = []
    const hostSolidJs = { createSignal: () => [() => "host", () => undefined] }
    const hostOpenTuiSolid = createOpenTuiSolidRuntime("host")
    mock.module(virtualSolidJsSpecifier, () => hostSolidJs)
    mock.module(virtualOpenTuiSolidSpecifier, () => hostOpenTuiSolid)
    const { loadHostSolidRuntime } = await loadFreshHostRuntime(logs)

    // when
    const result = await loadHostSolidRuntime()

    // then
    expect(result.source).toBe("host-virtual")
    expect(result.solidJs?.createSignal).toBe(hostSolidJs.createSignal)
    expect(result.opentuiSolid?.createElement).toBe(hostOpenTuiSolid.createElement)
    expect(result.opentuiSolid?.insert).toBe(hostOpenTuiSolid.insert)
    expect(result.opentuiSolid?.setProp).toBe(hostOpenTuiSolid.setProp)
  })
})
