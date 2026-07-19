import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const AGENTS_PATH = join(import.meta.dir, "..", "AGENTS.md")

function readAgents(): string {
  return readFileSync(AGENTS_PATH, "utf8")
}

describe("AGENTS.md dev-environment documentation", () => {
  test("#given root AGENTS.md #when scanned #then it documents the shared setup/cleanup scripts and every harness wiring", () => {
    // given
    const content = readAgents()

    // then
    const required: ReadonlyArray<readonly [token: string, why: string]> = [
      ["script/agent/setup.sh", "shared bootstrap"],
      ["script/agent/cleanup.sh", "shared teardown"],
      ["script/agent/cleanup-hook.sh", "Claude shutdown-safe teardown launcher"],
      ["script/agent/qa-sandbox.sh", "isolated QA helper"],
      [".env.example", "credential injection point"],
      [".devcontainer", "Codespaces + Dev Containers wiring"],
      [".claude/settings.json", "Claude Code wiring"],
      [".codex/setup.sh", "Codex App wiring"],
    ]
    for (const [token, why] of required) {
      expect(content, `AGENTS.md must document ${why} (${token})`).toContain(token)
    }
  })

  test("#given the dev-environment section #when scanned #then it names a single source of truth and a keep-in-sync maintenance directive", () => {
    // given
    const content = readAgents()
    const lower = content.toLowerCase()

    // then
    expect(content).toContain("single source of truth") // setup.sh is canonical
    expect(lower).toContain("in sync") // update docs when the scripts change
  })

  test("#given the maintenance directive #when scanned #then it requires updating the matching QA skill", () => {
    // given
    const content = readAgents()
    const lower = content.toLowerCase()

    // then
    expect(lower).toContain("and the matching skill")
  })
})
