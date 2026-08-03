# Todo inject write-path spike

## Verdict

Use a read-merge-write port backed by OpenCode's SQLite `todo` table, with an injectable writer seam for tests and future runtime adapters.

Why:

- The SDK client surface is read-only for todos. Existing repo code calls `client.session.todo({ path: { id: sessionID } })` only as a read in `packages/omo-opencode/src/tools/session-manager/sdk-storage.ts:130-145`. The installed SDK typings expose `session.todo(...)` as “Get a session's todo list” in `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts:136-138`; the request type has `body?: never` and `url: "/session/{id}/todo"` in `node_modules/.bun/@opencode-ai+sdk@1.15.13/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:1974-1986`, with only a `200: Array<Todo>` response in `types.gen.d.ts:1998-2003`.
- The internal `Todo.update` route is the only repo precedent for writes: `packages/omo-opencode/src/hooks/compaction-todo-preserver/hook.ts:85-94` dynamically imports `opencode/session/todo`, and `hook.ts:167-176` calls the resolved writer. However, live isolated OpenCode v1.18.5 QA showed that an external file plugin cannot resolve `opencode/session/todo`; see `.omo/evidence/20260802-mailbox-granular-injection/task-5-todoupdate-unavailable-result.json`.
- The working route was verified against a real isolated OpenCode server by mutating the SQLite todo table and then reading back through `client.session.todo`. The success artifact is `.omo/evidence/20260802-mailbox-granular-injection/task-5-live-result.json`.

## Port contract

`createTodoInjector(deps)` returns:

- `append(sessionID, item)`: adds the item at the end.
- `insertNext(sessionID, item)`: inserts immediately after the current `in_progress` todo, or at the front when none is in progress.
- `prepend(sessionID, item)`: adds the item at the front.

Each method reads the current todos from `client.session.todo`, merges one item into that list, then writes the whole list. If `client.session.get` cannot find the target session, or if the writer throws, the port logs the reason and falls back to `addBoulderWork`.
