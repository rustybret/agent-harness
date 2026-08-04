# Error payloads logged as "[object Object]"

## What was tested

Whether a failed internal operation records enough to diagnose it when the thrown value is not an
`Error`.

Surface driven: the real prompt-async gate (`dispatchInternalPrompt`) made to fail with each
rejection shape seen in the live log, capturing what the failure line would carry
(`driver.mjs`).

Behavior it was meant to prove: a non-Error rejection stays readable, and the `Error` path is
unchanged.

## What was observed

Live plugin log baseline (`live-log-baseline.json`): **74 log lines carried
`"error":"[object Object]"`**, concentrated in the paths that matter most when the harness stalls -
`[ralph-loop] Retrying after runtime session error` 24, `[prompt-async-gate] promptAsync failed`
22, plus ralph-loop session-create / TUI-select / verification-scan failures and
`[atlas] Boulder continuation failed`. Each reported that something failed while withholding what.

Driver, before vs after (`before-log-shapes.json`, `after-log-shapes.json`):

| rejection shape | before | after |
|---|---|---|
| plain object `{status:429, body:{message:"rate limited"}}` | `[object Object]` | `{"status":429,"body":{"message":"rate limited"}}` |
| `TypeError` instance | `TypeError: session.messages is not a function` | unchanged |
| string rejection | `network rejected promptAsync` | unchanged |
| object with a real `toString` | `ProviderError: quota exhausted` | unchanged |

Only the shape that was broken changed. This matters because a 429 rate limit and a routing bug
were previously indistinguishable in the log.

## Why it is enough

The measurement drives the production dispatch path rather than the helper in isolation, and the
before-capture is the same driver with only the changed file stashed, so the delta is attributable.
Three of the four shapes are byte-identical across the boundary, which is the evidence that the fix
adds a fallback rather than altering existing rendering.

Note this is distinct from the earlier `serialize-log-data` fix. That one covered `Error` objects
passed to the logger as data. These 74 lines were pre-stringified by the CALLER with
`String(error)` before the logger ever saw them, so the logger could not help. The new
`describeErrorForLog` is the caller-side equivalent, applied to the 17 call sites that produced
these lines - including 10 that read
`error instanceof Error ? String(error) : String(error)`, a no-op ternary where both branches were
identical.

Residual risk: 552 further `String(error)` occurrences remain across the workspace, most of them
outside logging (error message construction, user-facing text). They were left alone because they
did not appear in the observed log lines; if one starts failing with a non-Error payload it will
show the same way and can be converted the same way. All 10 no-op
`error instanceof Error ? String(error) : String(error)` ternaries are now gone.

## What was omitted

The driver constructs its own rejections and never contacts a provider, so no credentials or
session state are involved. The live-log baseline records message text and counts only, not log
payloads.
