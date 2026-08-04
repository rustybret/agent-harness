# The todo-continuation hook crashed out of session.idle

## How this was found

Log mining. `[event] hook execution failed` appeared 22 times in the recent window; every payload
was the same hook and the same error:

```
hook: todoContinuationEnforcer   eventType: session.idle
TypeError: todos.filter is not a function
  at getIncompleteCount   at handleSessionIdle
```

Across the whole log: **25 occurrences spanning 24 distinct sessions**. This is not a cosmetic log
line - the hook throws before it can decide whether to continue, so todo continuation silently stops
working for that session. The failure is invisible to the user: the session just stops continuing.

## Root cause

`normalizeSDKResponse` is the shared adapter every SDK call site uses to narrow a host response to
its declared type. Its `preferResponseOnMissingData` mode - used by the todo call sites - returns
the raw response whenever there is no usable `data`, with an unchecked `as TData`.

So when the host answers `session.todo` with anything that is not a list (an error envelope such as
`{ data: null, error: ... }`, a bare object, a string body), the caller receives that value typed as
`Todo[]`. The call site cannot defend itself, because the type system already declared it safe -
`getIncompleteCount` calls `.filter` and throws.

The guard clause immediately above the crash makes this concrete:

```ts
if (!todos || todos.length === 0) { ... return }   // an object passes: truthy, length undefined
const incompleteCount = getIncompleteCount(todos)  // throws here
```

This is a shared-helper defect, not a todo defect. 58 call sites across 36 files use
`normalizeSDKResponse`; every one that declared an array fallback had the same exposure.

## What was tested

`drive.mjs` drives the REAL `handleSessionIdle` - the exact function named in the stack trace -
against six response shapes a host can return, and records whether the hook completes or throws.

## What was observed

| shape | before | after |
|---|---|---|
| error envelope (`data: null` + error) | **THREW** `TypeError: todos.filter...` | completed |
| bare error object | **THREW** | completed |
| bare object body | **THREW** | completed |
| string body | **THREW** | completed |
| proper envelope | completed | completed |
| proper bare array | completed | completed |

4 of 6 crashed before, 0 after, with both valid shapes behaving identically. Full captures:
`before-no-guard.json`, `after-shape-guard.json`. Before-capture taken by reverting only
`normalize-sdk-response.ts` via `git stash`, re-running the same driver, then restoring -
byte-identical restore verified with `cmp` (`RESTORED-OK`).

## Why this is enough

The fix enforces the caller's declared shape: array-ness of `fallback` is now the contract, so a
caller that asked for a list always gets a list, and a caller that asked for a record never gets a
list. That covers all 58 call sites at once rather than patching the two todo ones.

Five regression tests, all verified to FAIL against the reverted helper and pass against the fix:

- four in `normalize-sdk-response.test.ts` - error envelope, bare object, and non-object bodies all
  resolve to the array fallback; an array resolving where a record was declared falls back too.
- one in `idle-event.test.ts` - `handleSessionIdle` resolves rather than throwing when
  `session.todo` answers with an error envelope, and takes the no-todos path.

A fifth test pins the shape that must NOT regress: a bare record body still resolves for
record-declaring callers (the session-status map several call sites rely on).

Full suite green (13781 pass / 0 fail), typecheck clean.

## What was omitted

No secrets are involved. The driver uses stub clients and touches no filesystem or network. Session
ids in the log excerpt are local identifiers.

Not addressed: WHY the host returned a non-list for `session.todo`. The affected session ids are not
all in this machine's database, and the plugin log is machine-wide, so some come from other repos'
opencode instances. The hook now degrades to "no todos" instead of dying, which is the correct
behavior either way, but a host that persistently fails this call will silently stop continuing
rather than reporting the underlying fault.
