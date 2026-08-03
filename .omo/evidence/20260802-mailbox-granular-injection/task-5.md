# Task 5 evidence - todo write-path spike and todoInjector port

## What was tested

- Unit gate: `bun test packages/omo-opencode/src/features/cross-project-mailbox/todo-inject`.
- Live OpenCode QA: isolated-XDG server launched through the `opencode-qa` sandbox conventions, with a temporary file plugin importing `createTodoInjector`, creating a real session, calling `append` and `prepend`, then reading the result back through `client.session.todo`.
- Spike comparison: SDK typings and repo precedents were inspected for `client.session.todo` and `Todo.update`; live QA also preserved the failed `Todo.update` import result.

## What was observed

- Unit tests passed: 6 pass, 0 fail, including append, insertNext after `in_progress`, insertNext with no current item, prepend, dead-session fallback, and write-throw fallback.
- Live QA passed. Artifact: `task-5-live-result.json` reports `success: true`, session `ses_03c16f01affePuYoMexN2c7qsg`, `appendResult.outcome: written`, `prependResult.outcome: written`, and final todos in expected order: prepended item first, appended item last.
- `Todo.update` was not usable from an external file plugin in isolated OpenCode v1.18.5. Artifact: `task-5-todoupdate-unavailable-result.json` records `Cannot find module 'opencode/session/todo'`.
- Cleanup/isolation receipt: `task-5-cleanup-receipt.txt`. The host DB session count changed during QA, but the QA session ID had zero hits in the host DB; the sandbox root was manually removed after cleanup verification.

## Why this is enough

- The unit tests prove the port's ordering and fallback semantics against an injected fake client/writer.
- The live smoke proves the selected SQLite write route mutates a real OpenCode session in an isolated server and that the public read route sees the mutation afterward.
- The spike artifacts explain why downstream tasks should not depend on an SDK todo write method or on resolving `opencode/session/todo` from file-plugin code.

## What was omitted

- Full server logs are kept in `task-5-server.log`; no provider secrets, auth headers, or private prompt contents were copied here.
