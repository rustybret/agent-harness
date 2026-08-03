import { describe, test, expect } from "bun:test"
import {
  buildTopMenu,
  buildSubmenu,
  applySelection,
  MalformedConfigError,
  type TopMenuRow,
} from "./menu-model"
import type { ProjectEntry } from "../registry/types"
import type { CrossProjectMailboxConfig } from "../config"
import { CrossProjectMailboxConfigSchema } from "../config"

function parseMailboxSenders(text: string): Record<string, unknown> {
  return JSON.parse(text)["[opencode]"].cross_project_mailbox.senders
}

describe("menu-model", () => {
  describe("buildTopMenu", () => {
    const selfProjectId = "self-123"
    const entries: ProjectEntry[] = [
      { projectId: "self-123", displayName: "self", repoRoot: "/self", lastSeen: 0 },
      { projectId: "alpha-111", displayName: "alpha", repoRoot: "/alpha", lastSeen: 0 },
      { projectId: "beta-222", displayName: "beta", repoRoot: "/beta1", lastSeen: 0 },
      { projectId: "beta-333", displayName: "beta", repoRoot: "/beta2", lastSeen: 0 },
      { projectId: "gamma-444", displayName: "gamma", repoRoot: "/gamma", lastSeen: 0 },
    ]

    const config = {
      senders: {
        "alpha-111": { access: "allow", intent_budget: "plan" },
        "beta-222": { access: "deny", intent_budget: "impl" },
        // beta-333 is unlisted
        "gamma-444": { access: "allow", intent_budget: "question" },
      },
    } as unknown as CrossProjectMailboxConfig

    test("#given entries and config #when buildTopMenu is called #then it returns correct rows sorted alphabetically by displayName and tie-broken by projectId", () => {
      const rows = buildTopMenu(entries, config, selfProjectId)

      expect(rows).toHaveLength(4)

      // Alphabetical order by displayName, tie-broken by projectId
      expect(rows[0].projectId).toBe("alpha-111")
      expect(rows[1].projectId).toBe("beta-222")
      expect(rows[2].projectId).toBe("beta-333")
      expect(rows[3].projectId).toBe("gamma-444")

      // Labels: singletons use displayName, collisions use projectId
      expect(rows[0].label).toBe("alpha")
      expect(rows[1].label).toBe("beta-222")
      expect(rows[2].label).toBe("beta-333")
      expect(rows[3].label).toBe("gamma")

      // States
      expect(rows[0].state).toBe("plan") // allow + plan
      expect(rows[1].state).toBe("Disabled") // deny
      expect(rows[2].state).toBe("Disabled") // unlisted
      expect(rows[3].state).toBe("question") // allow + question
    })

    test("#given collision entries (two cloudhome-* entries) #when buildTopMenu is called #then both show full id-suffixed label while singleton shows bare name", () => {
      const cloudEntries: ProjectEntry[] = [
        { projectId: "cloudhome-11111111", displayName: "cloudhome", repoRoot: "/a/cloudhome", lastSeen: 0 },
        { projectId: "cloudhome-22222222", displayName: "cloudhome", repoRoot: "/b/cloudhome", lastSeen: 0 },
        { projectId: "singleton-33333333", displayName: "singleton", repoRoot: "/c/singleton", lastSeen: 0 },
      ]
      const rows = buildTopMenu(cloudEntries, {} as CrossProjectMailboxConfig, "other-self")
      expect(rows).toHaveLength(3)
      expect(rows[0].label).toBe("cloudhome-11111111")
      expect(rows[1].label).toBe("cloudhome-22222222")
      expect(rows[2].label).toBe("singleton")
    })

    test("#given entries where displayName is empty string #when buildTopMenu is called #then it falls back to stripped projectId for bareName and collision check", () => {
      const emptyNameEntries: ProjectEntry[] = [
        { projectId: "proj-11111111", displayName: "", repoRoot: "/a/proj", lastSeen: 0 },
        { projectId: "proj-22222222", displayName: "", repoRoot: "/b/proj", lastSeen: 0 },
        { projectId: "unique-33333333", displayName: "", repoRoot: "/c/unique", lastSeen: 0 },
      ]
      const rows = buildTopMenu(emptyNameEntries, {} as CrossProjectMailboxConfig, "other-self")
      expect(rows).toHaveLength(3)
      expect(rows[0].label).toBe("proj-11111111")
      expect(rows[1].label).toBe("proj-22222222")
      expect(rows[2].label).toBe("unique")
    })

    test("#given config without senders property #when buildTopMenu is called #then all entries default to Disabled state", () => {
      const rows = buildTopMenu(entries, {} as CrossProjectMailboxConfig, selfProjectId)
      expect(rows.every((r) => r.state === "Disabled")).toBe(true)
    })

    test("#given sender with access allow but missing intent_budget #when buildTopMenu is called #then state defaults to Disabled", () => {
      const partialConfig = {
        senders: {
          "alpha-111": { access: "allow" },
        },
      } as unknown as CrossProjectMailboxConfig
      const rows = buildTopMenu(entries, partialConfig, selfProjectId)
      expect(rows[0].state).toBe("Disabled")
    })
  })

  describe("buildSubmenu", () => {
    test("#given a row with state impl #when buildSubmenu is called #then it returns options with ✓ impl marked and selected true", () => {
      const options = buildSubmenu({ projectId: "test", label: "test", state: "impl" })
      expect(options).toEqual([
        { choice: "Disabled", value: "Disabled", label: "Disabled", selected: false },
        { choice: "question", value: "question", label: "question", selected: false },
        { choice: "impl", value: "impl", label: "✓ impl", selected: true },
        { choice: "plan", value: "plan", label: "plan", selected: false },
      ])
    })

    test("#given rows with each possible state #when buildSubmenu is called #then the matching option has ✓ and selected true", () => {
      const states: Array<TopMenuRow["state"]> = ["Disabled", "question", "impl", "plan"]
      for (const state of states) {
        const options = buildSubmenu({ projectId: "test", label: "test", state })
        const selectedOpt = options.find((o) => o.selected)
        expect(selectedOpt?.choice).toBe(state)
        expect(selectedOpt?.label).toBe(`✓ ${state}`)
        expect(options.filter((o) => !o.selected).every((o) => o.label === o.choice)).toBe(true)
      }
    })
  })

  describe("applySelection", () => {
    test("#given unlisted project #when choice is question #then it sets access allow and intent_budget question", () => {
      const result = applySelection("{}", "proj-1", "question")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "question",
      })
    })

    test("#given unlisted project #when choice is impl #then it sets access allow and intent_budget impl", () => {
      const result = applySelection("{}", "proj-1", "impl")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "impl",
      })
    })

    test("#given unlisted project #when choice is plan #then it sets access allow and intent_budget plan", () => {
      const result = applySelection("{}", "proj-1", "plan")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "plan",
      })
    })

    test("#given unlisted project #when choice is Disabled #then it sets access deny and intent_budget question", () => {
      const result = applySelection("{}", "proj-1", "Disabled")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "deny",
        intent_budget: "question",
      })
    })

    test("#given allow+impl project #when choice is Disabled #then it sets access deny and preserves existing intent_budget impl", () => {
      const initial = JSON.stringify({
        "[opencode]": {
          cross_project_mailbox: {
            senders: {
              "proj-1": { access: "allow", intent_budget: "impl" },
            },
          },
        },
      })
      const result = applySelection(initial, "proj-1", "Disabled")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "deny",
        intent_budget: "impl",
      })
    })

    test("#given allow project without intent_budget #when choice is Disabled #then it sets access deny and adds intent_budget question", () => {
      const initial = JSON.stringify({
        "[opencode]": {
          cross_project_mailbox: {
            senders: {
              "proj-1": { access: "allow" },
            },
          },
        },
      })
      const result = applySelection(initial, "proj-1", "Disabled")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "deny",
        intent_budget: "question",
      })
    })

    test("#given deny+question project #when choice is question #then it sets access allow and intent_budget question", () => {
      const initial = JSON.stringify({
        "[opencode]": {
          cross_project_mailbox: {
            senders: {
              "proj-1": { access: "deny", intent_budget: "question" },
            },
          },
        },
      })
      const result = applySelection(initial, "proj-1", "question")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "question",
      })
    })

    test("#given deny+question project #when choice is impl #then it sets access allow and intent_budget impl", () => {
      const initial = JSON.stringify({
        "[opencode]": {
          cross_project_mailbox: {
            senders: {
              "proj-1": { access: "deny", intent_budget: "question" },
            },
          },
        },
      })
      const result = applySelection(initial, "proj-1", "impl")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "impl",
      })
    })

    test("#given deny+question project #when choice is plan #then it sets access allow and intent_budget plan", () => {
      const initial = JSON.stringify({
        "[opencode]": {
          cross_project_mailbox: {
            senders: {
              "proj-1": { access: "deny", intent_budget: "question" },
            },
          },
        },
      })
      const result = applySelection(initial, "proj-1", "plan")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "plan",
      })
    })

    test("#given config text MISSING cross_project_mailbox key entirely (hand-edited file) #when choice is applied #then modify creates nested path and result validates against CrossProjectMailboxConfigSchema", () => {
      const initial = `{\n  "other_setting": true\n}`
      const result = applySelection(initial, "proj-1", "plan")
      const parsed = JSON.parse(result)
      expect(parsed.other_setting).toBe(true)
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "plan",
      })
      const validated = CrossProjectMailboxConfigSchema.parse(parsed["[opencode]"].cross_project_mailbox)
      expect(validated.senders["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "plan",
      })
    })

    test("#given empty string config text #when choice is applied #then it initializes object and applies selection", () => {
      const result = applySelection("", "proj-1", "impl")
      expect(parseMailboxSenders(result)["proj-1"]).toEqual({
        access: "allow",
        intent_budget: "impl",
      })
    })

    test("#given config with comments and unrelated keys #when choice is applied #then comments and unrelated keys are preserved byte-for-byte outside edited span", () => {
      const initial = `{
  // Top level comment
  "unrelated_key": "value",
  "[opencode]": {
    "cross_project_mailbox": {
      // Mailbox comment
      "senders": {
        // Existing sender comment
        "proj-1": {
          "access": "deny",
          "intent_budget": "plan"
        }
      }
    }
  }
}`
      const result = applySelection(initial, "proj-1", "impl")
      expect(result).toContain("// Top level comment")
      expect(result).toContain('"unrelated_key": "value"')
      expect(result).toContain("// Mailbox comment")
      expect(result).toContain("// Existing sender comment")
      expect(result).toContain('"access": "allow"')
      expect(result).toContain('"intent_budget": "impl"')
    })

    test("#given same selection twice #when applied #then output is stable (idempotent re-apply)", () => {
      const initial = `{}`
      const first = applySelection(initial, "proj-1", "plan")
      const second = applySelection(first, "proj-1", "plan")
      expect(first).toBe(second)
    })

    test("#given malformed JSONC config text #when applySelection is called #then it throws MalformedConfigError with descriptive message", () => {
      const malformed = `{ "[opencode]": { "cross_project_mailbox": { "senders": { "proj-1": { "access": "allow", } } } } }`
      expect(() => applySelection(malformed, "proj-1", "impl")).toThrow(MalformedConfigError)
      expect(() => applySelection(malformed, "proj-1", "impl")).toThrow(/Malformed JSONC configuration text/)
    })

    test("#given non-object JSON root (e.g. array or string) #when applySelection is called #then it throws MalformedConfigError", () => {
      expect(() => applySelection(`["not an object"]`, "proj-1", "impl")).toThrow(MalformedConfigError)
      expect(() => applySelection(`"just a string"`, "proj-1", "impl")).toThrow(MalformedConfigError)
    })
  })
})
