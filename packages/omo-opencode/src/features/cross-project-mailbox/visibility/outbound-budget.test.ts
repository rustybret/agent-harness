import { describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema, type CrossProjectMailboxConfig } from "../config"
import type { PresenceStatus } from "../presence"
import type { ProjectEntry } from "../registry/types"
import {
  hashOutboundBudget,
  presenceLabel,
  readOutboundBudget,
  renderOutboundBudgetTable,
  selectOutboundBudgetInjection,
} from "./index"

function cfg(overrides: Record<string, unknown> = {}): CrossProjectMailboxConfig {
  return CrossProjectMailboxConfigSchema.parse({
    enabled: true,
    senders: {
      "proj-b": { access: "allow", intent_budget: "plan" },
      "proj-a": { access: "allow", intent_budget: "quick" },
    },
    ...overrides,
  })
}

const PROJECTS: ProjectEntry[] = [
  { projectId: "proj-b", repoRoot: "/tmp/b", displayName: "Project B", lastSeen: 2 },
  { projectId: "proj-a", repoRoot: "/tmp/a", displayName: "Project A", lastSeen: 1 },
]

function registryOf(projects: ProjectEntry[]): { listProjects: () => Promise<ProjectEntry[]> } {
  return { listProjects: async () => projects }
}

describe("readOutboundBudget", () => {
  it("probes every target concurrently so one unresponsive target does not delay the rest", async () => {
    // given four targets, each probe held open until every probe has started
    const config = CrossProjectMailboxConfigSchema.parse({
      enabled: true,
      senders: {
        "proj-a": { access: "allow", intent_budget: "quick" },
        "proj-b": { access: "allow", intent_budget: "quick" },
        "proj-c": { access: "allow", intent_budget: "quick" },
        "proj-d": { access: "allow", intent_budget: "quick" },
      },
    })
    let inFlight = 0
    let peakInFlight = 0
    let releaseAll: () => void = () => {}
    const allStarted = new Promise<void>((resolve) => {
      releaseAll = resolve
    })

    // when
    const rows = await readOutboundBudget(config, registryOf([]), {
      readPresence: async () => {
        inFlight += 1
        peakInFlight = Math.max(peakInFlight, inFlight)
        if (inFlight === 4) releaseAll()
        await allStarted
        inFlight -= 1
        return "live"
      },
    })

    // then all four were open at once; serial resolution would deadlock waiting for the fourth
    expect(rows).toHaveLength(4)
    expect(peakInFlight).toBe(4)
  })

  it("yields one row per allow-listed target with resolved display name and granted ceiling", async () => {
    // given
    const presenceById: Record<string, PresenceStatus> = { "proj-b": "live", "proj-a": "stale" }

    // when
    const rows = await readOutboundBudget(cfg(), registryOf(PROJECTS), {
      readPresence: async (id) => presenceById[id] ?? "offline",
    })

    // then
    expect(rows).toHaveLength(2)
    const byId = new Map(rows.map((row) => [row.targetProjectId, row]))
    const b = byId.get("proj-b")
    const a = byId.get("proj-a")
    expect(b?.displayName).toBe("Project B")
    expect(b?.grantedCeiling).toBe("plan")
    expect(b?.presence).toBe("live")
    // "quick" is a legacy intent that maps onto the canonical "impl" tier
    expect(a?.displayName).toBe("Project A")
    expect(a?.grantedCeiling).toBe("impl")
    expect(a?.presence).toBe("stale")
  })

  it("skips denied senders and falls back to projectId when the target is unregistered", async () => {
    // given
    const config = cfg({
      senders: {
        "proj-b": { access: "allow", intent_budget: "plan" },
        "proj-a": { access: "deny", intent_budget: "plan" },
        "proj-z": { access: "allow", intent_budget: "question" },
      },
    })

    // when
    const rows = await readOutboundBudget(config, registryOf(PROJECTS), {
      readPresence: async () => "offline",
    })

    // then
    expect(rows.map((row) => row.targetProjectId).sort()).toEqual(["proj-b", "proj-z"])
    const z = rows.find((row) => row.targetProjectId === "proj-z")
    expect(z?.displayName).toBe("proj-z")
    expect(z?.presence).toBe("offline")
  })

  it("includes implicitly allowed registered targets with question ceiling when default_sender_access is allow-all", async () => {
    // given
    const config = cfg({
      default_sender_access: "allow-all",
      senders: {
        "proj-b": { access: "allow", intent_budget: "plan" },
        "proj-a": { access: "deny", intent_budget: "plan" },
      },
    })
    const projects: ProjectEntry[] = [
      { projectId: "proj-b", repoRoot: "/tmp/b", displayName: "Project B", lastSeen: 2 },
      { projectId: "proj-a", repoRoot: "/tmp/a", displayName: "Project A", lastSeen: 1 },
      { projectId: "proj-c", repoRoot: "/tmp/c", displayName: "Project C", lastSeen: 3 },
    ]

    // when
    const rows = await readOutboundBudget(config, registryOf(projects), {
      readPresence: async () => "offline",
    })

    // then
    expect(rows.map((row) => row.targetProjectId).sort()).toEqual(["proj-b", "proj-c"])
    const c = rows.find((row) => row.targetProjectId === "proj-c")
    expect(c?.displayName).toBe("Project C")
    expect(c?.grantedCeiling).toBe("question")
  })

  it("maps an internal presence status straight through to the row presence field", async () => {
    // given
    const config = cfg({ senders: { "proj-b": { access: "allow", intent_budget: "plan" } } })

    // when
    const rows = await readOutboundBudget(config, registryOf(PROJECTS), {
      readPresence: async () => "internal",
    })

    // then
    expect(rows).toHaveLength(1)
    expect(rows[0]?.presence).toBe("internal")
  })

  it("reports unknown presence when the presence reader throws", async () => {
    // given
    const config = cfg({ senders: { "proj-b": { access: "allow", intent_budget: "plan" } } })

    // when
    const rows = await readOutboundBudget(config, registryOf(PROJECTS), {
      readPresence: async () => {
        throw new Error("probe boom")
      },
    })

    // then
    expect(rows).toHaveLength(1)
    expect(rows[0]?.presence).toBe("unknown")
  })

  it("caps the number of returned rows at maxTargets", async () => {
    // given
    const senders: Record<string, { access: string; intent_budget: string }> = {}
    const projects: ProjectEntry[] = []
    for (let i = 0; i < 25; i++) {
      senders[`p-${i}`] = { access: "allow", intent_budget: "plan" }
      projects.push({ projectId: `p-${i}`, repoRoot: `/tmp/${i}`, displayName: `P${i}`, lastSeen: i })
    }
    const config = cfg({ senders })

    // when
    const rows = await readOutboundBudget(config, registryOf(projects), {
      readPresence: async () => "offline",
      maxTargets: 20,
    })

    // then
    expect(rows).toHaveLength(20)
  })
})

describe("presenceLabel", () => {
  it("labels internal presence as doc-drop and passes every other status through unchanged", () => {
    // then
    expect(presenceLabel("internal")).toBe("internal (doc-drop)")
    expect(presenceLabel("live")).toBe("live")
    expect(presenceLabel("stale")).toBe("stale")
    expect(presenceLabel("offline")).toBe("offline")
    expect(presenceLabel("unknown")).toBe("unknown")
  })
})

describe("renderOutboundBudgetTable / hashOutboundBudget", () => {
  it("renders an advisory-marked markdown table with one line per row", () => {
    // given
    const rows = [
      { targetProjectId: "proj-b", displayName: "Project B", grantedCeiling: "plan", presence: "live" as const },
    ]

    // when
    const table = renderOutboundBudgetTable(rows)

    // then
    expect(table).toContain("ADVISORY")
    expect(table).toContain("Project B")
    expect(table).toContain("plan")
    expect(table).toContain("live")
  })

  it("renders the internal doc-drop label for an internal presence row", () => {
    // given
    const rows = [
      {
        targetProjectId: "proj-b",
        displayName: "Project B",
        grantedCeiling: "plan",
        presence: "internal" as const,
      },
    ]

    // when
    const table = renderOutboundBudgetTable(rows)

    // then
    expect(table).toContain("internal (doc-drop)")
  })

  it("renders the raw presence token for non-internal rows with no regression", () => {
    // given
    const rows = [
      { targetProjectId: "proj-a", displayName: "Project A", grantedCeiling: "plan", presence: "live" as const },
      { targetProjectId: "proj-b", displayName: "Project B", grantedCeiling: "plan", presence: "stale" as const },
      { targetProjectId: "proj-c", displayName: "Project C", grantedCeiling: "plan", presence: "offline" as const },
      { targetProjectId: "proj-d", displayName: "Project D", grantedCeiling: "plan", presence: "unknown" as const },
    ]

    // when
    const table = renderOutboundBudgetTable(rows)

    // then
    expect(table).toContain("| Project A | proj-a | plan | live |")
    expect(table).toContain("| Project B | proj-b | plan | stale |")
    expect(table).toContain("| Project C | proj-c | plan | offline |")
    expect(table).toContain("| Project D | proj-d | plan | unknown |")
    expect(table).not.toContain("doc-drop")
  })

  it("produces the same hash for equal rows and a different hash when a value changes", () => {
    // given
    const rows = [
      { targetProjectId: "proj-b", displayName: "Project B", grantedCeiling: "plan", presence: "live" as const },
    ]
    const changed = [
      { targetProjectId: "proj-b", displayName: "Project B", grantedCeiling: "plan", presence: "stale" as const },
    ]

    // then
    expect(hashOutboundBudget(rows)).toBe(hashOutboundBudget(rows))
    expect(hashOutboundBudget(rows)).not.toBe(hashOutboundBudget(changed))
  })
})

describe("selectOutboundBudgetInjection", () => {
  it("injects on the first computed hash and skips when the hash is unchanged", () => {
    // given
    const store = new Map<string, string>()
    const rows = [
      { targetProjectId: "proj-b", displayName: "Project B", grantedCeiling: "plan", presence: "live" as const },
    ]

    // when
    const first = selectOutboundBudgetInjection("ses-1", rows, store)
    const second = selectOutboundBudgetInjection("ses-1", rows, store)

    // then
    expect(first.inject).toBe(true)
    expect(typeof first.text).toBe("string")
    expect(second.inject).toBe(false)
    expect(second.text).toBeUndefined()
  })

  it("re-injects when the table content changes for the same session", () => {
    // given
    const store = new Map<string, string>()
    const rows = [
      { targetProjectId: "proj-b", displayName: "Project B", grantedCeiling: "plan", presence: "live" as const },
    ]
    const changed = [
      { targetProjectId: "proj-b", displayName: "Project B", grantedCeiling: "plan", presence: "offline" as const },
    ]

    // when
    const first = selectOutboundBudgetInjection("ses-1", rows, store)
    const second = selectOutboundBudgetInjection("ses-1", changed, store)

    // then
    expect(first.inject).toBe(true)
    expect(second.inject).toBe(true)
  })

  it("does not inject when there are no rows", () => {
    // given
    const store = new Map<string, string>()

    // when
    const result = selectOutboundBudgetInjection("ses-1", [], store)

    // then
    expect(result.inject).toBe(false)
  })
})
