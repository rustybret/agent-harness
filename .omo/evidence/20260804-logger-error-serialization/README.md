# Plugin logger discarded Error message and stack

## What was tested

The real shared logger (`packages/utils/src/logging/logger.ts`, the `createLogger` used by
`packages/omo-opencode/src/shared/logger.ts`), driven against the exact error shapes observed
losing their content in the live plugin log.

Driver: `.local-ignore/qa/log-error-driver.mjs` — logs four payloads through the production logger,
reads the resulting file back from disk, and reports what each line actually carries.

Behavior it was meant to prove: an `Error` passed as log data lands with its message, errno code,
cause chain, and aggregated errors intact instead of serializing to `{}`.

## What was observed

Field evidence from the live log at `$TMPDIR/oh-my-opencode.log`: **292 error lines across 17
distinct call sites** were written with a literally empty error payload (`"error":{}`), so the
diagnostic carried nothing. Top sites:

| call site | lines |
|---|---|
| `[tui-sidebar] mirror flush failed` | 260 |
| `[atlas] Failed to resolve session lineage` | 6 |
| `[mailbox] legacy-senders-notice flag delete failed` | 4 |
| `[messages-transform] hook execution failed` | 3 |
| 13 further sites (background-agent, transcript, formatter-trigger, model-fallback, …) | 1-2 each |

Mechanism: `message` and `stack` are non-enumerable own properties of `Error`, so
`JSON.stringify(new Error("boom"))` returns `{}`. Confirmed directly:

```
plain Error       -> {"code":"EACCES"}     (message and stack dropped)
with cause        -> {"error":{}}
AggregateError    -> {"error":{}}
```

Driver before/after (`before-logger-errors.json`, `after-logger-errors.json`):

| payload | before | after |
|---|---|---|
| plain `Error("ENOSPC: ...")` | `{}` — empty | message + 2 stack frames |
| `Error("flush failed", { cause })` | `{}` — empty | message + `cause.message: "disk full"` |
| errno `Error` + `code: EACCES` | `{"code":"EACCES"}` — no message | message + code + path |
| `AggregateError` of 2 | `{}` — empty | message + both aggregated messages |

Three of four real-world shapes previously logged nothing at all.

## Why it is enough

The driver runs the production `createLogger` end to end — write, flush, read back from disk — so
the assertion is on bytes actually written, not on a stub. Unit coverage pins each branch in
`packages/utils/src/logging/serialize-log-data.test.ts` (message/stack lifted, errno code kept,
cause chain readable, AggregateError members readable, cause depth bounded, stack truncated, plain
objects byte-identical to `JSON.stringify`, cyclic payload still skipped) plus a logger-level test
asserting the written line contains the message rather than `"error":{}`.

Bounded by construction: stack capped at 4 frames and cause chains at depth 3, so restoring these
diagnostics does not reintroduce log bloat. Non-error payloads serialize exactly as before, which
the equality test pins.

Full suite: 13,723 pass / 0 fail. Typecheck clean.

Residual risk: call sites that pass a non-Error value (a string, or an object built by hand) are
unchanged — this fix only affects real `Error` instances.

## What was omitted

Field log lines are summarized as per-site counts rather than copied, since the log interleaves
session ids, absolute paths, and prompt fragments.
