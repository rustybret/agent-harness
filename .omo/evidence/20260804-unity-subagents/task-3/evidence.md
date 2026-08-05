# QA Evidence - Todo 3: Wire vendored skills via skills.sources in project .omo/omo.jsonc

## WHAT WAS TESTED
- Edited `.omo/omo.jsonc` to add the `"skills"` configuration under the existing `"[opencode]"` block.
- Added the comment: `// vendored unitySuperMCP domain skills, synced manually via packages/supermcp-skills/scripts/sync-from-source.mjs`
- Added the `"skills"` block:
  ```json
  "skills": {
    "sources": [
      {
        "path": "packages/supermcp-skills/skills",
        "recursive": true
      }
    ]
  }
  ```
- Validated that the file parses correctly as JSONC using the project's `parseJsonc` utility from `packages/utils/src/jsonc-parser.ts`.

## WHAT WAS OBSERVED
- The file `.omo/omo.jsonc` was successfully updated.
- The JSONC parser successfully parsed the updated file without any syntax errors.
- The output of the parser verified that the `"[opencode]"` block contains the new `"skills"` key with the correct structure.
- The git diff shows only the added lines under the `"[opencode]"` block, leaving other keys (`git_master`, `cross_project_mailbox`, `external_inject`) untouched.

## WHY IT IS ENOUGH
- The JSONC parsing check ensures that the configuration file remains syntactically valid and can be loaded by the plugin.
- The path is relative (`packages/supermcp-skills/skills`), which is portable and resolves correctly against the project root.
- The comment is correctly placed above the `"skills"` key.

## WHAT WAS OMITTED
- None.
