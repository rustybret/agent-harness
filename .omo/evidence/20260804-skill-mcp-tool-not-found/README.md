# "Tool not found" told the caller nothing about what the server does expose

## How this was found

Mining tool error RATES in the stored session database (rather than raw counts) put `skill_mcp` at
the top: **634 errors across 2842 calls, 22.3%** - the worst of any tool with meaningful volume.
Breaking that down, `MCP error -32603: Tool not found` accounted for 85 of them.

The revealing number is the spread: **89 failures spanning 63 DISTINCT guessed tool names against a
single server** (`supermcp`). That ratio is the signature of guessing, not of a typo.

## Root cause

`skill_mcp` already handles an unknown SERVER well - it lists the available ones and hints how to
load a skill:

```
Error: MCP server "unity-mcp" not found.

Available MCP servers in loaded skills:
  - "playwright" from skill "playwright"
```

But an unknown TOOL on a KNOWN server got the server's raw message and nothing else. The caller is
told the name is wrong and given no way to find the right one, so the only move left is another
guess - which the 63-distinct-names figure shows is exactly what happened.

The manager already had `listTools` / `listResources` / `listPrompts`; the failure path just never
asked.

## What was tested

`drive.mjs` runs the REAL registered `skill_mcp` tool against a REAL stdio MCP server
(`fake-mcp-server.mjs`, speaking real JSON-RPC over stdin/stdout) - not a mocked manager. It replays
the actual tool names that failed against `supermcp` in production, pulled from the session
database.

A local server is used rather than the real Unity bridge because the bridge is not running and the
defect is in how OUR tool reports the server's rejection, which is identical either way. The
protocol path, the connection, and the manager are all real.

## What was observed

| tool_name | before | after |
|---|---|---|
| `bridge_status` (exists) | succeeded | succeeded |
| `oa_find` | `MCP error -32603: Tool not found` (32 chars) | + names `bridge_status`, `scene_open` (149 chars) |
| `scene_get_open` | same bare 32 chars | + names both tools (156 chars) |
| `read_console` | same bare 32 chars | + names both tools (154 chars) |

`namesAvailableTools` went from `false` on every failure to `true` on every failure. The success
path is byte-identical - the list is fetched only after a failure.

Captures: `before-bare-error.json`, `after-names-tools.json`. Before-capture taken by reverting only
`tools.ts` via `git stash`, re-running the same driver, then restoring - byte-identical restore
verified with `cmp` (`RESTORED-OK`).

## Why this is enough

The driver exercises the real tool over the real MCP protocol with the real failing inputs. Four
regression tests cover the shape and its guard rails, two of which FAIL against the original:

- a not-found tool error names the available tools,
- a prompt operation lists prompts rather than tools (the label follows the operation),
- when listing ALSO fails the original error is preserved - a diagnostic must never replace the
  fault it is describing,
- an unrelated failure (`Unity bridge did not respond before timeout`, 81 occurrences in the same
  data) does not trigger a list fetch at all.

Full workspace suite green, typecheck clean.

## What was omitted

Not addressed: the other 549 `skill_mcp` errors, which are connection failures against servers that
were not running (`supermcp` 44, `macos-cua` 21, `jenkins` 14). Those are environment state rather
than a harness defect - the message already names the URL or command that failed.

The 60-name cap on the list is arbitrary but bounded on purpose: a server exposing hundreds of tools
should not turn one error into a wall of text.
