# Exa Research Skill — Tier 3 Skill-Embedded MCP

## TL;DR

> **Quick Summary**: Create an `exa-research` user skill that embeds the Exa AI MCP server as a Tier 3 skill-embedded remote MCP, giving agents on-demand access to Exa's semantic search alongside the already-configured Tavily built-in websearch.
> 
> **Deliverables**:
> - `~/.config/opencode/skills/exa-research/SKILL.md` — skill file with YAML frontmatter + agent instructions
> - `EXA_API_KEY` configured in shell environment
> - Verified: skill loads, MCP connects, search returns results
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: NO — 2 sequential tasks
> **Critical Path**: Task 1 (create skill) → Task 2 (verify it works)

---

## Context

### Original Request
User wants both Exa AI and Tavily web search available to agents. Tavily is already configured as the built-in Tier 1 `websearch` MCP. Exa should be added as a Tier 3 skill-embedded MCP to avoid context bloat.

### Interview Summary
**Key Discussions**:
- Exa and Tavily were thoroughly compared across tools, parameters, and strengths
- Exa excels at semantic/neural search, query-dependent highlights, and category filtering (people, company, research papers)
- Tavily excels at crawl/map/extract/research workflows
- Oh-my-opencode's Tier 3 skill MCP system was analyzed: YAML frontmatter declares MCPs, `skill_mcp` invokes them, per-session isolation, auto-cleanup after 5min idle

**Research Findings**:
- Exa MCP endpoint: `https://mcp.exa.ai/mcp?tools=web_search_exa` (confirmed from `src/mcp/websearch.ts:36-37`)
- Auth: `x-api-key` header + `exaApiKey` query param (confirmed from `src/mcp/websearch.ts:35-39`)
- Skill MCP env expansion: `expandEnvVarsInObject(config, { trusted: isTrusted })` in `src/features/skill-mcp-manager/connection.ts:43`
- User-scope skills are trusted for env expansion (`!PROJECT_SCOPES.has(info.scope)`)
- Exa tools: `web_search_exa(query, numResults)`, `web_fetch_exa(urls, maxCharacters)`, `web_search_advanced_exa(...full params...)`

### Metis Review
**Identified Gaps** (addressed):
- Endpoint conflict (`mcp.exa.ai` vs `api.exa.ai`): Resolved — confirmed `https://mcp.exa.ai/mcp` from source code
- Env var trust scope: Resolved — user-scope skills are trusted
- Tool filter concern: The `?tools=web_search_exa` query param limits to one tool; skill should use full endpoint without tool filter to expose all 3 tools
- Missing failure handling instructions: Added to skill content
- Missing acceptance criteria: Added executable QA scenarios

---

## Work Objectives

### Core Objective
Create a single SKILL.md file that embeds Exa AI as a Tier 3 skill MCP, providing agents with on-demand semantic web search.

### Concrete Deliverables
- `~/.config/opencode/skills/exa-research/SKILL.md`

### Definition of Done
- [ ] Skill file exists at correct path with valid YAML frontmatter
- [ ] MCP server config uses remote HTTP type with correct Exa endpoint
- [ ] Auth uses `${EXA_API_KEY}` env var (no hardcoded keys)
- [ ] Skill instructions guide agents on Exa vs Tavily usage
- [ ] Skill loads successfully in oh-my-opencode session
- [ ] `skill_mcp` can invoke Exa search and return results

### Must Have
- YAML frontmatter with `name`, `description`, and `mcp` block
- Remote HTTP MCP pointing to Exa endpoint
- `x-api-key: ${EXA_API_KEY}` header for auth
- Agent instructions explaining when to use Exa vs Tavily
- Tool reference documentation for all 3 Exa tools
- Failure handling guidance (missing key, auth errors, rate limits, timeouts)

### Must NOT Have (Guardrails)
- MUST NOT hardcode any API key in the skill file
- MUST NOT modify any TypeScript source code in oh-my-opencode
- MUST NOT modify the existing Tavily built-in websearch configuration
- MUST NOT create additional config files, CLI commands, or TypeScript modules
- MUST NOT place the skill in project scope (would block env var expansion)
- MUST NOT disable or replace any existing MCP
- MUST NOT over-engineer: one SKILL.md file, nothing else

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: N/A (not a code change — skill file only)
- **Automated tests**: None (no TypeScript to test)
- **Framework**: N/A

### QA Policy
Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Skill file**: Use Bash — validate file existence, YAML structure, content checks
- **MCP connection**: Use Bash — invoke skill_mcp via the running session

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Sequential — 2 tasks):
├── Task 1: Create SKILL.md file [quick]
└── Task 2: Verify skill loads and MCP connects (depends: 1) [quick]

Wave FINAL (After ALL tasks):
└── Task F1: Scope fidelity check [quick]

Critical Path: Task 1 → Task 2 → F1
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | None | 2 |
| 2 | 1 | F1 |
| F1 | 2 | — |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T2 → `quick`
- **FINAL**: 1 task — F1 → `quick`

---

## TODOs

- [x] 1. Create Exa Research Skill File

  **What to do**:
  - Create directory `~/.config/opencode/skills/exa-research/`
  - Create `SKILL.md` with YAML frontmatter declaring the Exa MCP server
  - MCP config must use:
    - Server name: `exa`
    - Type: `http`
    - URL: `https://mcp.exa.ai/mcp` (WITHOUT `?tools=web_search_exa` filter — let it expose all tools)
    - Headers: `x-api-key: ${EXA_API_KEY}`
  - Skill body must include:
    - Description of what Exa provides (semantic search, highlights, categories)
    - Clear decision guide: when to use Exa vs Tavily (table format)
    - Tool reference for all 3 Exa tools with parameters:
      - `web_search_exa(query, numResults)` — basic semantic search
      - `web_fetch_exa(urls, maxCharacters)` — fetch known URLs
      - `web_search_advanced_exa(query, numResults, type, category, includeDomains, excludeDomains, startPublishedDate, endPublishedDate, includeText, excludeText, enableHighlights, enableSummary)` — full-featured search
    - Workflow examples showing typical usage patterns
    - Failure handling section: missing EXA_API_KEY, 401 auth errors, 429 rate limits, timeouts, empty results
    - Note that Tavily is always available as the built-in `websearch` MCP for crawl/map/extract tasks

  **Must NOT do**:
  - Hardcode any API key value in the file
  - Use `${EXA_API_KEY}` in the URL (only in the header — the URL should NOT contain the key)
  - Add `?tools=web_search_exa` to the URL (this restricts available tools)
  - Modify any existing oh-my-opencode source files
  - Create any additional files beyond the single SKILL.md

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file creation with known content, no complex logic
  - **Skills**: []
    - No skills needed — straightforward file write

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 2
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/features/builtin-skills/skills/playwright.ts` — canonical example of a built-in skill with `mcpConfig` block; shows how MCP servers are declared for skills
  - `src/features/opencode-skill-loader/skill-mcp-config.ts:6-18` — YAML frontmatter parser; shows expected `mcp:` key structure
  - `src/features/skill-mcp-manager/connection.ts:42-43` — env var expansion; confirms `${EXA_API_KEY}` will be expanded for trusted (user-scope) skills

  **API/Type References**:
  - `src/mcp/websearch.ts:33-41` — the existing Exa MCP config pattern: URL format, `x-api-key` header, `exaApiKey` query param
  - `src/features/claude-code-mcp-loader/AGENTS.md` — documents the `.mcp.json` format which the SKILL.md YAML mirrors

  **External References**:
  - Exa MCP docs: `https://docs.exa.ai/reference/exa-mcp` — official tool list and parameters
  - Exa MCP repo: `https://github.com/exa-labs/exa-mcp-server` — source of truth for tool schemas

  **WHY Each Reference Matters**:
  - `playwright.ts` shows the canonical structure so the executor matches existing patterns
  - `skill-mcp-config.ts` shows what YAML keys the parser expects (`mcp:` at top level)
  - `connection.ts` proves `${EXA_API_KEY}` will be expanded in user-scope skills
  - `websearch.ts` shows the exact URL and header format Exa expects

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Skill file exists with correct structure
    Tool: Bash
    Preconditions: Task 1 completed
    Steps:
      1. Run: test -f ~/.config/opencode/skills/exa-research/SKILL.md && echo "EXISTS" || echo "MISSING"
      2. Run: head -1 ~/.config/opencode/skills/exa-research/SKILL.md
      3. Run: grep -c "^---" ~/.config/opencode/skills/exa-research/SKILL.md
    Expected Result: File EXISTS, first line is "---", grep returns "2" (opening and closing frontmatter delimiters)
    Failure Indicators: File MISSING, first line is not "---", grep returns != 2
    Evidence: .sisyphus/evidence/task-1-file-structure.txt

  Scenario: YAML frontmatter contains required fields
    Tool: Bash
    Preconditions: Skill file exists
    Steps:
      1. Run: grep "^name:" ~/.config/opencode/skills/exa-research/SKILL.md || grep "name:" ~/.config/opencode/skills/exa-research/SKILL.md | head -1
      2. Run: grep "description:" ~/.config/opencode/skills/exa-research/SKILL.md | head -1
      3. Run: grep "mcp:" ~/.config/opencode/skills/exa-research/SKILL.md | head -1
    Expected Result: All three greps return matching lines
    Failure Indicators: Any grep returns empty
    Evidence: .sisyphus/evidence/task-1-yaml-fields.txt

  Scenario: No hardcoded API key in file
    Tool: Bash
    Preconditions: Skill file exists
    Steps:
      1. Run: grep -i "EXA_API_KEY" ~/.config/opencode/skills/exa-research/SKILL.md
      2. Verify all matches use ${EXA_API_KEY} syntax, never a raw key value
      3. Run: grep -E "[a-zA-Z0-9]{20,}" ~/.config/opencode/skills/exa-research/SKILL.md | grep -iv "url\|http\|mcp\|exa\|search\|domain\|publish\|crawl\|highlight" | wc -l
    Expected Result: Step 1 shows only `${EXA_API_KEY}` references; Step 3 returns 0 (no suspicious long strings)
    Failure Indicators: Raw API key found, or suspicious long alphanumeric strings present
    Evidence: .sisyphus/evidence/task-1-no-secrets.txt

  Scenario: MCP config points to correct Exa endpoint
    Tool: Bash
    Preconditions: Skill file exists
    Steps:
      1. Run: grep "mcp.exa.ai" ~/.config/opencode/skills/exa-research/SKILL.md
      2. Run: grep "x-api-key" ~/.config/opencode/skills/exa-research/SKILL.md
      3. Run: grep "type:.*http" ~/.config/opencode/skills/exa-research/SKILL.md || grep "url:" ~/.config/opencode/skills/exa-research/SKILL.md
    Expected Result: URL contains "mcp.exa.ai/mcp", header references x-api-key with ${EXA_API_KEY}, type is http or url is present
    Failure Indicators: Wrong endpoint, missing auth header, wrong type
    Evidence: .sisyphus/evidence/task-1-mcp-config.txt

  Scenario: Skill content includes Exa vs Tavily guidance
    Tool: Bash
    Preconditions: Skill file exists
    Steps:
      1. Run: grep -ci "tavily" ~/.config/opencode/skills/exa-research/SKILL.md
      2. Run: grep -ci "semantic" ~/.config/opencode/skills/exa-research/SKILL.md
      3. Run: grep -ci "web_search_exa\|web_fetch_exa\|web_search_advanced" ~/.config/opencode/skills/exa-research/SKILL.md
    Expected Result: Step 1 >= 2 (Tavily mentioned in comparison), Step 2 >= 1, Step 3 >= 3 (all 3 tools documented)
    Failure Indicators: Tavily not mentioned, tools not documented
    Evidence: .sisyphus/evidence/task-1-content-guidance.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-file-structure.txt
  - [ ] task-1-yaml-fields.txt
  - [ ] task-1-no-secrets.txt
  - [ ] task-1-mcp-config.txt
  - [ ] task-1-content-guidance.txt

  **Commit**: NO (file is outside repository)

- [x] 2. Verify Skill Loads and Exa MCP Connects

  **What to do**:
  - Set `EXA_API_KEY` environment variable (use placeholder `tav1` or user's real key if available)
  - Verify the skill appears in the skill listing by checking the file is parseable
  - Use `skill_mcp` to list tools from the Exa MCP server
  - Execute a test search via `skill_mcp` calling `web_search_exa` with query `"OpenCode plugin"` and `numResults: 3`
  - Verify results contain URLs and titles
  - Test failure mode: unset `EXA_API_KEY` and attempt connection — verify clean error

  **Must NOT do**:
  - Modify the SKILL.md file (that's Task 1's job)
  - Modify any oh-my-opencode source code
  - Change the Tavily built-in configuration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Verification steps only, no code changes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (after Task 1)
  - **Blocks**: F1
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/tools/skill-mcp/tools.ts` — how `skill_mcp` resolves and invokes MCP servers from loaded skills
  - `src/tools/skill-mcp/constants.ts` — built-in MCP tool hints (websearch, context7, grep_app)
  - `src/features/skill-mcp-manager/http-client.ts` — HTTP client factory used for remote MCP connections

  **WHY Each Reference Matters**:
  - `tools.ts` shows the invocation path: `findMcpServer` → `manager.callTool`
  - `constants.ts` shows how built-in MCP tools are hinted (Exa skill tools won't be here — that's expected)
  - `http-client.ts` shows error messages for connection failures (useful for debugging)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Skill MCP lists Exa tools
    Tool: skill_mcp (via the running session)
    Preconditions: EXA_API_KEY is set, skill file exists from Task 1
    Steps:
      1. Load the exa-research skill via skill tool
      2. Call skill_mcp with mcp_name="exa", tool_name to list available tools
      3. Verify response includes web_search_exa
    Expected Result: Tool listing includes at least web_search_exa
    Failure Indicators: Connection error, empty tool list, auth failure
    Evidence: .sisyphus/evidence/task-2-tool-listing.txt

  Scenario: Exa search returns results
    Tool: skill_mcp (via the running session)
    Preconditions: EXA_API_KEY is set, skill loaded
    Steps:
      1. Call skill_mcp with mcp_name="exa", tool_name="web_search_exa", arguments={"query": "OpenCode plugin MCP", "numResults": 3}
      2. Parse response for URLs and titles
    Expected Result: Response contains >= 1 result with a URL and title
    Failure Indicators: Empty results, error response, timeout
    Evidence: .sisyphus/evidence/task-2-search-results.txt

  Scenario: Missing API key produces clean error
    Tool: Bash + skill_mcp
    Preconditions: EXA_API_KEY is NOT set
    Steps:
      1. Unset EXA_API_KEY in environment
      2. Attempt to invoke skill_mcp with mcp_name="exa"
      3. Check error message is clear and contains no raw secrets
    Expected Result: Clear error indicating authentication failure or missing key
    Failure Indicators: Cryptic error, raw secrets in output, silent failure
    Evidence: .sisyphus/evidence/task-2-missing-key-error.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-tool-listing.txt
  - [ ] task-2-search-results.txt
  - [ ] task-2-missing-key-error.txt

  **Commit**: NO (verification only, no file changes)

---

## Final Verification Wave

- [x] F1. **Scope Fidelity Check** — `quick`
  Verify: only one file was created (`~/.config/opencode/skills/exa-research/SKILL.md`). No TypeScript files modified. No config files changed. Tavily built-in websearch unchanged.
  Output: `Files created [1] | Files modified [0] | Tavily intact [YES/NO] | VERDICT`

---

## Commit Strategy

- No commits needed — this creates a user skill file outside the repository

---

## Success Criteria

### Verification Commands
```bash
cat ~/.config/opencode/skills/exa-research/SKILL.md  # Expected: valid SKILL.md with YAML frontmatter
grep -c 'EXA_API_KEY' ~/.config/opencode/skills/exa-research/SKILL.md  # Expected: >= 1 (env var reference, no raw key)
```

### Final Checklist
- [ ] SKILL.md exists at `~/.config/opencode/skills/exa-research/`
- [ ] YAML frontmatter contains `name`, `description`, `mcp` block
- [ ] MCP type is `http` with correct Exa URL
- [ ] Auth header uses `${EXA_API_KEY}` interpolation
- [ ] Instructions cover Exa vs Tavily decision guidance
- [ ] Instructions cover failure modes
- [ ] No hardcoded API keys anywhere in the file
- [ ] No TypeScript source modifications
- [ ] Tavily built-in websearch remains active and unchanged
