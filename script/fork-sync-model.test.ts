import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// Fork sync model audit — enforces the fast-forward-or-merge sync policy.
//
// The fork syncs upstream via script/fork-sync.sh (FF-or-merge, never rebase,
// never force-push). This audit is a code/config guard, not a prose pin: it
// scans the executable surfaces (the sync script, the workflow templates, the
// parsed exclusion manifest, and the runbook's command fences) for
// history-rewriting commands. The recurring failure mode was a rebase +
// force-push sync being reintroduced by exactly these artifacts.

const ROOT = join(import.meta.dir, "..")
const SCRIPT = join(ROOT, "script/fork-sync.sh")
const EXCLUSIONS = join(ROOT, "script/fork-sync-exclusions")
const GUIDE = join(ROOT, "docs/guide/fork-maintenance-guide.md")
const TEMPLATES_DIR = join(ROOT, ".github/fork-templates")

// Command tokens that must never appear in executable sync surface.
const FORBIDDEN_TOKENS: Array<{ token: RegExp; why: string }> = [
  { token: /\bgit\s+rebase\b/, why: "rebase-based sync is banned (rewrites published history)" },
  { token: /\bgit\s+pull\b/, why: "git pull may rebase; use fetch + merge --ff-only" },
  { token: /--force-with-lease/, why: "force-push is banned on fork/local" },
  { token: /--force(?:-|\s|$|=)/, why: "force-push is banned on fork/local" },
  { token: /\breset\s+--hard\b/, why: "destructive reset is banned on pushed branches" },
]

// Parses the exclusion manifest exactly the way script/fork-sync.sh does:
// strip `#` comments, trim, dispatch on the directive prefix.
function parseManifest(text: string): { keepDeleted: string[]; keepOurs: string[]; takeTheirs: string[] } {
  const keepDeleted: string[] = []
  const keepOurs: string[] = []
  const takeTheirs: string[] = []
  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0]!.trim()
    if (line === "") continue
    if (line.startsWith("keep-deleted:")) keepDeleted.push(line.slice("keep-deleted:".length).trim())
    else if (line.startsWith("keep-ours:")) keepOurs.push(line.slice("keep-ours:".length).trim())
    else if (line.startsWith("take-theirs:")) takeTheirs.push(line.slice("take-theirs:".length).trim())
  }
  return { keepDeleted, keepOurs, takeTheirs }
}

// Returns only the code-fence segments of a markdown runbook (the executable
// command surface a reader is told to run).
function codeFences(text: string): string[] {
  const fences: string[] = []
  let inFence = false
  let current = ""
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      if (inFence) fences.push(current)
      inFence = !inFence
      current = ""
      continue
    }
    if (inFence) current += line + "\n"
  }
  return fences
}

describe("#given the fork sync model", () => {
  test("script/fork-sync.sh exists and never invokes banned commands", () => {
    // when the executable sync script is read
    expect(existsSync(SCRIPT)).toBe(true)
    const script = readFileSync(SCRIPT, "utf8")
    // then it must not contain history-rewriting or force-push commands
    for (const { token, why } of FORBIDDEN_TOKENS) {
      const match = script.match(token)
      expect(match, `${token} found in ${SCRIPT} (${why})`).toBeNull()
    }
  })

  test("script/fork-sync.sh implements the ff-or-merge procedure", () => {
    // given the executable sync script
    const script = readFileSync(SCRIPT, "utf8")
    // then its command surface must implement mirror FF + fork merge + manifest
    expect(script).toContain("merge --ff-only")
    expect(script).toContain("fork/local")
    expect(script).toContain("fork-sync-exclusions")
    expect(script).toContain("checkout --ours")
    expect(script).toContain("checkout --theirs")
  })

  test("guide code fences contain no banned commands", () => {
    // given the maintenance runbook
    expect(existsSync(GUIDE)).toBe(true)
    const guide = readFileSync(GUIDE, "utf8")
    // when only its executable code fences are inspected
    const fences = codeFences(guide)
    expect(fences.length).toBeGreaterThan(0)
    // then no fence may instruct a history-rewriting or force-push command
    for (const fence of fences) {
      for (const { token, why } of FORBIDDEN_TOKENS) {
        const match = fence.match(token)
        expect(match, `${token} found in a code fence of ${GUIDE} (${why})`).toBeNull()
      }
    }
  })

  test("sync-upstream.yml GitHub workflow template is gone (no GitHub automation)", () => {
    // when the fork templates directory is inspected
    const templateNames = existsSync(TEMPLATES_DIR) ? readdirSync(TEMPLATES_DIR) : []
    // then the rebase-based GitHub Actions sync template must not exist
    expect(templateNames).not.toContain("sync-upstream.yml")
  })

  test("remaining fork templates contain no banned commands", () => {
    // given any workflow templates still present
    if (!existsSync(TEMPLATES_DIR)) return
    const templateNames = readdirSync(TEMPLATES_DIR)
    // when each is read in full
    for (const name of templateNames) {
      const template = readFileSync(join(TEMPLATES_DIR, name), "utf8")
      // then it must not reintroduce rebase/force-push automation
      for (const { token, why } of FORBIDDEN_TOKENS) {
        const match = template.match(token)
        expect(match, `${token} found in .github/fork-templates/${name} (${why})`).toBeNull()
      }
    }
  })

  test("exclusion manifest parses and covers every standing fork-exclusion path", () => {
    // given the manifest parsed with the same logic the sync script uses
    expect(existsSync(EXCLUSIONS)).toBe(true)
    const { keepDeleted, keepOurs } = parseManifest(readFileSync(EXCLUSIONS, "utf8"))
    // then every standing deleted-by-us path from the 2026-08-07 sync must be
    // covered by a keep-deleted glob (missing glob = the next sync re-conflicts)
    for (const glob of [
      ".github/workflows/*", // ci, lint-workflows, publish-platform, web-ci, web-deploy
      ".github/FUNDING.yml",
      ".github/scripts/*",
      "packages/web/*", // package.json + bun.lock (whole web package excluded)
      ".opencode/skills/github-triage/*",
      ".opencode/skills/pre-publish-review/*",
      ".opencode/skills/work-with-pr-workspace/*",
      ".opencode/command/publish.md",
      ".opencode/command/get-unpublished-changes.md",
      ".opencode/command/omomomo.md",
    ]) {
      expect(keepDeleted, `missing keep-deleted glob: ${glob}`).toContain(glob)
    }
    // and regenerable extension & installer bundles must be keep-ours
    for (const glob of [
      "packages/omo-senpi/plugin/extensions/omo.js",
      "packages/omo-senpi/plugin/extensions/omo-member.js",
      "packages/omo-codex/scripts/install-dist/install-local.mjs",
    ]) {
      expect(keepOurs, `missing keep-ours glob: ${glob}`).toContain(glob)
    }
  })
})
