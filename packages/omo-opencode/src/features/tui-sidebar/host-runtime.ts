import { log } from "../../shared/logger"

export type HostSolidRuntime<Node = unknown> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (parent: Node, child: Node | string) => unknown
  readonly setProp: (node: Node, name: string, value: unknown) => unknown
}

export type HostSolidSignals = Pick<typeof import("solid-js"), "createSignal">

export type HostSolidRuntimeSource = "host-virtual" | "bare-import" | "none"

export type HostSolidRuntimeLoadResult<Node = unknown> = {
  readonly solidJs: HostSolidSignals | null
  readonly opentuiSolid: HostSolidRuntime<Node> | null
  readonly source: HostSolidRuntimeSource
}

type LoadedHostRuntime<Node> = {
  readonly solidJs: HostSolidSignals | null
  readonly opentuiSolid: HostSolidRuntime<Node>
}

function isHostSolidSignals(candidate: unknown): candidate is HostSolidSignals {
  return typeof candidate === "object" && candidate !== null && "createSignal" in candidate && typeof candidate.createSignal === "function"
}

function isHostSolidRuntime<Node>(candidate: unknown): candidate is HostSolidRuntime<Node> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "createElement" in candidate &&
    typeof candidate.createElement === "function" &&
    "insert" in candidate &&
    typeof candidate.insert === "function" &&
    "setProp" in candidate &&
    typeof candidate.setProp === "function"
  )
}

async function loadHostVirtualRuntime<Node>(): Promise<LoadedHostRuntime<Node> | null> {
  const solidJsSpecifier = "opentui:runtime-module:" + encodeURIComponent("solid-js")
  const opentuiSolidSpecifier = "opentui:runtime-module:" + encodeURIComponent("@opentui/solid")

  try {
    const solidJsModule: unknown = await import(solidJsSpecifier)
    const opentuiSolidModule: unknown = await import(opentuiSolidSpecifier)
    if (!isHostSolidSignals(solidJsModule) || !isHostSolidRuntime<Node>(opentuiSolidModule)) return null
    return { solidJs: solidJsModule, opentuiSolid: opentuiSolidModule }
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}

async function loadBareRuntime<Node>(): Promise<LoadedHostRuntime<Node> | null> {
  try {
    const opentuiSolidModule: unknown = await import("@opentui/solid")
    if (!isHostSolidRuntime<Node>(opentuiSolidModule)) return null
    return { solidJs: await loadBareSolidJs(), opentuiSolid: opentuiSolidModule }
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}

async function loadBareSolidJs(): Promise<HostSolidSignals | null> {
  try {
    const solidJsModule: unknown = await import("solid-js")
    if (!isHostSolidSignals(solidJsModule)) return null
    return solidJsModule
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}

export async function loadHostSolidRuntime<Node = unknown>(): Promise<HostSolidRuntimeLoadResult<Node>> {
  const hostVirtual = await loadHostVirtualRuntime<Node>()
  if (hostVirtual) {
    log("[tui-sidebar] host runtime source", { source: "host-virtual" })
    return { ...hostVirtual, source: "host-virtual" }
  }

  const bareImport = await loadBareRuntime<Node>()
  if (bareImport) {
    log("[tui-sidebar] host runtime source", { source: "bare-import" })
    return { ...bareImport, source: "bare-import" }
  }

  log("[tui-sidebar] host runtime source", { source: "none" })
  return { solidJs: null, opentuiSolid: null, source: "none" }
}
