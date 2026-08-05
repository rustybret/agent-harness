# QA Evidence - Task 4: Remediate dead unity-gamedev.json into a working unity-gamedev.md agent

## WHAT WAS TESTED
Remediated the dead `.opencode/agents/unity-gamedev.json` and `.opencode/prompts/unity-gamedev.md` into a single native markdown agent `.opencode/agents/unity-gamedev.md`.

## WHAT WAS OBSERVED
1. Created `.opencode/agents/unity-gamedev.md` with the correct frontmatter:
   ```yaml
   ---
   description: "Unity game-dev specialist. Drives scene/script/asset/compile/build workflows via the SuperMCP bridge. Understands the compile->domain-reload cycle, modal-decision flows, idempotency discipline, and background-throttle caveats. Touchpoints go ONLY through bridge tools and skills."
   mode: subagent
   model: anthropic/claude-sonnet-4-6
   variant: high
   temperature: 0.1
   ---
   ```
2. Inlined the prompt body and replaced the stale "235+ tools" figure with "153 registered tools (live count; grows per release)".
3. Deleted `.opencode/agents/unity-gamedev.json` and `.opencode/prompts/unity-gamedev.md`.
4. Ran `bun run typecheck` and `bun test` successfully.

### Dead-Config Proof Citations
- **Harness Compatibility Loader:**
  `packages/claude-code-compat-core/src/features/claude-code-agent-loader/loader.ts` line 18:
  ```typescript
  if (!isMarkdownFile(entry)) continue
  ```
  This filters out non-markdown files (like `.json` files) when loading agents.
  
  `packages/utils/src/file-utils.ts` line 10:
  ```typescript
  export function isMarkdownFile(entry: { name: string; isFile: () => boolean }): boolean {
  	return !entry.name.startsWith(".") && entry.name.endsWith(".md") && entry.isFile()
  }
  ```
  This defines `isMarkdownFile` to only match files ending with `.md`.

- **Native OpenCode Agent Loader:**
  `/Volumes/Topper2TB/Git/opencode/packages/opencode/src/config/agent.ts` line 13:
  ```typescript
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
  ```
  This scans only for `.md` files, meaning `.json` files are completely ignored.

  `/Volumes/Topper2TB/Git/opencode/packages/core/src/v1/config/agent.ts` lines 12-41:
  Defines the schema for the agent configuration (which is parsed from the frontmatter of the markdown file).

## WHY IT IS ENOUGH
The code citations prove that `.json` agent configurations are dead config and never loaded by either the compatibility layer or the native OpenCode agent loader. The new `.md` agent is correctly structured and verified by the test suite.

## WHAT WAS OMITTED
None.
