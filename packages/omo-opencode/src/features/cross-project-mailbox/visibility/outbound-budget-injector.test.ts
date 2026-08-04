import { describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema, type CrossProjectMailboxConfig } from "../config"
import { createPresenceCache, PRESENCE_INTERVAL_MS, type PresenceStatus } from "../presence"
import type { ProjectEntry } from "../registry/types"
import { createOutboundBudgetInjector } from "./outbound-budget-injector"
import type { OutboundBudgetRegistryPort } from "./outbound-budget"

function cfg(overrides: Record<string, unknown> = {}): CrossProjectMailboxConfig {
  return CrossProjectMailboxConfigSchema.parse({
    enabled: true,
    senders: {
      "proj-a": { access: "allow", intent_budget: "plan" },
    },
    ...overrides,
  })
}

const PROJECTS: ProjectEntry[] = [
  { projectId: "proj-a", repoRoot: "/tmp/a", displayName: "Project A", lastSeen: 1 },
]

function registryOf(projects: ProjectEntry[]): OutboundBudgetRegistryPort {
  return { listProjects: async () => projects }
}

type TransformPart = { type: string; text?: string; synthetic?: boolean }
type MessageWithParts = { info: { role: string; sessionID?: string }; parts: TransformPart[] }

function userMessage(sessionID: string): MessageWithParts {
  return { info: { role: "user", sessionID }, parts: [{ type: "text", text: "hi" }] }
}

function injectedTexts(messages: MessageWithParts[]): string[] {
  return messages
    .flatMap((message) => message.parts)
    .filter((part) => part.synthetic === true && typeof part.text === "string")
    .map((part) => part.text as string)
}

describe("createOutboundBudgetInjector", () => {
  it("#given an internal-presence target #when the transform runs #then the injected advisory table carries the doc-drop label", async () => {
    // given
    const readPresence = async (): Promise<PresenceStatus> => "internal"
    const injector = createOutboundBudgetInjector({
      config: cfg(),
      directory: "/tmp/self",
      registry: registryOf(PROJECTS),
      readPresence,
    })
    const output = { messages: [userMessage("ses-1")] }

    // when
    await injector["experimental.chat.messages.transform"]?.({ sessionID: "ses-1" }, output)

    // then
    const texts = injectedTexts(output.messages)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain("internal (doc-drop)")
    expect(texts[0]).toContain("Project A")
  })

  it("#given an offline-presence target #when the transform runs #then the injected table shows offline and never doc-drop", async () => {
    // given
    const readPresence = async (): Promise<PresenceStatus> => "offline"
    const injector = createOutboundBudgetInjector({
      config: cfg(),
      directory: "/tmp/self",
      registry: registryOf(PROJECTS),
      readPresence,
    })
    const output = { messages: [userMessage("ses-2")] }

    // when
    await injector["experimental.chat.messages.transform"]?.({ sessionID: "ses-2" }, output)

    // then
    const texts = injectedTexts(output.messages)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain("| Project A | proj-a | plan | offline |")
    expect(texts[0]).not.toContain("doc-drop")
  })

  it("#given repeat chat turns #when the transform runs #then presence is probed once, not once per turn", async () => {
    // given an injector using its real cached presence path (no readPresence override)
    let probes = 0
    const presenceCache = createPresenceCache(PRESENCE_INTERVAL_MS, {
      readDetail: async () => {
        probes += 1
        return { status: "live", heartbeatTs: Date.now() }
      },
    })
    const injector = createOutboundBudgetInjector({
      config: cfg(),
      directory: "/tmp/self",
      registry: registryOf(PROJECTS),
      presenceCache,
    })

    // when three turns run inside the cache window
    for (const session of ["ses-a", "ses-b", "ses-c"]) {
      await injector["experimental.chat.messages.transform"]?.(
        { sessionID: session },
        { messages: [userMessage(session)] },
      )
    }

    // then the target was probed once - a network probe per turn is what stalled the chat path
    expect(probes).toBe(1)
  })
})
