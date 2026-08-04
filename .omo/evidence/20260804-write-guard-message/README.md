# write-existing-file-guard: block message named no recovery path

## What was tested

The `write` tool's guard against overwriting a file the session has not read, driven through the
real `createWriteExistingFileGuardHook` `tool.execute.before` entry point (`drive.mjs`), replaying
the shape observed in production: a `write` to an existing file with no prior `read`.

The driver also exercises both documented recovery paths against the same hook instance, so the
message is checked against behaviour that actually exists rather than against itself.

## Why it was worth fixing

Session database, last 14 days: `write` failed 30 times out of 450 calls (6.7%), and 21 of those 30
were this one message, across 10 distinct sessions. Recovery was scattered - of the immediate next
tool calls after a block, 6 were `read`, 5 retried `write`, 5 switched to `edit`, 3 shelled out, and
one was a malformed call. Three of the five immediate `write` retries failed again.

The old text was `File already exists. Use edit tool instead.` It reads as a prohibition, and it is
wrong twice over:

- `edit` is the wrong advice when the intent is to replace the whole file.
- The guard is lifted by reading the file first, or by passing `overwrite: true`. The flag is
  stripped from args before the tool runs and appears in no tool schema, so the error text is the
  only place it can be discovered. It was not mentioned.

## What was observed

| | before | after |
|---|---|---|
| message | `File already exists. Use edit tool instead.` | names the file, the reason, and both exits |
| chars | 43 | 455 |
| names the refused file | no | yes |
| states file is unchanged | no | yes |
| names read-then-write recovery | no | yes |
| names `overwrite: true` | no | yes |
| `readThenWrite` actually works | yes | yes |
| `overwriteFlag` actually works | yes | yes |

`before-guard-message.json`, `after-guard-message.json`.

The decisive line is that `recoveryPathsWork` is `true` in BOTH runs: both exits already worked, so
this is purely a discoverability defect. No guard behaviour changed - the same writes are blocked
and the same writes are allowed, and `fileStillOriginal` is `true` in both, confirming the blocked
write never touched the file.

## Why it is enough

The driver uses the registered hook rather than a copy of its logic, and asserts the two recovery
paths by executing them. 6 unit tests pin the message contract in `block-message.test.ts`, including
a negative assertion that the old prohibition wording is gone. The 11 existing guard tests that
matched the old literal now match the invariant sentence, so they still fail if the block stops
firing. Full suite green.

## What was omitted

No secret-bearing output. Paths are temp dirs created by the driver.
