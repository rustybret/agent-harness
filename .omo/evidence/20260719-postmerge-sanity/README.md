# Post-Merge Sanity QA — Upstream v4.19.0 Merge + LSP Cargo Port + Test Stabilization

**Date:** 2026-07-19
**Scope:** Verifies the built plugin (`dist/index.js`) loads and functions correctly
in a real OpenCode session after:
- Upstream `dev` v4.19.0 merge into `fork/local` (commit `b92388f13`)
- LSP Cargo workspace resolution + cancellation port into `packages/lsp-core` /
  `packages/lsp-tools-mcp` (commits `183a4f4`, `a2ad2a584`)
- Post-merge test-suite stabilization: workflow test repair (`fdc5aab8a`),
  shared-skills Codex caching fix (`6b6a85fa0`), process-cleanup test harness fix
  (`a9aa59c0c`), and the `mock.module` global-cache-pollution root-cause fix in
  `live-config.test.ts` (dependency injection via `options.validate` instead of
  top-level `mock.module`)

Driven against a **real `opencode run`** (v1.18.2, the fork binary at
`~/.opencode/bin/opencode`) in an isolated XDG sandbox — not a mock, not a dry run.

## What was tested

`.local-ignore/qa/postmerge-sanity-qa.sh` (self-contained driver):

1. Spins up an isolated sandbox with its own `XDG_DATA_HOME` / `XDG_CONFIG_HOME` /
   `XDG_STATE_HOME` / `XDG_CACHE_HOME`.
2. Registers the freshly built local plugin (`file://<repo>`, directory form per
   memory #2021) in the sandboxed `opencode.json`.
3. Copies the real `auth.json` (OAuth tokens only — no session data) into the
   sandbox's `XDG_DATA_HOME/opencode/`, so a real Anthropic API call can succeed
   without touching the host's actual session database.
4. Runs `opencode run "respond with exactly the single word: pong" --format json
   --print-logs -m anthropic/claude-haiku-4-5-20251001` inside a project
   directory under the sandbox.
5. Asserts the plugin loads with zero plugin/module errors, the run exits 0, the
   JSON event stream contains a real model response, and the real DB session
   count is unchanged before/after (isolation proof).

## What was observed — 4/4 PASS

| Assertion | Result |
| --- | --- |
| No plugin/module load error strings in output or logs | PASS |
| `opencode run` exited 0 | PASS |
| JSON event stream contains a real model response (`text`/`step_finish`) | PASS |
| Real DB session count unchanged (6418 → 6418) | PASS |

Captured model response (`run-output.jsonl`):

```json
{"type":"text", ..., "part":{"type":"text","text":"pong", ...}}
{"type":"step_finish", ..., "tokens":{"total":40063,"input":3,"output":5, ...}}
```

Server log (`run-stderr.log`) confirms clean plugin bootstrap through the full
init sequence — config loading, LSP/formatter registration ("all LSPs are
disabled" / "all formatters are disabled" is expected: no `.opencode/lsp.json`
in the throwaway sandbox project), agent selection (`Sisyphus - ultraworker`),
and a normal `stream` → `process` → `exiting loop` → `disposing instance`
lifecycle with no errors.

## Why this is enough

This is a lightweight sanity check scoped to "does the plugin still load and
respond after the merge/port/test-fix work," not a re-verification of the
mailbox, external-inject, or TUI features already QA'd end-to-end in prior
evidence directories (`20260713-mailbox-restart-registration`,
`20260716-external-inject`, `mailbox-sidebar-aft`). Those features were not
touched by this round of work. The full unit/integration test suite (12510
pass / 0 fail / 7 skip) plus a clean workspace typecheck cover the code-level
correctness of the merge, LSP port, and mock-leak fix; this QA closes the gap
those cannot cover — that the compiled artifact actually boots and drives a
real model round-trip through the real harness, matching the repo's QA
discipline (never accept "it typechecks" as QA).

## Residual risk

- LSP-specific behavior (the ported Cargo workspace resolution/cancellation
  code) was not independently re-verified through this specific QA pass; it
  was already verified via standalone MCP requests against a multi-member
  Cargo workspace in the earlier port work (see session history, compartment
  "Hardened and committed LSP Cargo workspace resolution port"), and by the
  28-test Cargo regression suite included in the green full-suite run.
- Doctor command output was not captured cleanly in this pass (an earlier
  script iteration attempted `opencode doctor` with an invalid working
  directory and was corrected to drop that step — `opencode run` already
  proves plugin registration end-to-end, making a separate doctor check
  redundant for this scope).

## What was omitted

No raw secrets, tokens, or auth material are included in any captured file.
`auth.json` was copied into the sandbox only as an ephemeral runtime artifact
inside a `mktemp` directory that was deleted (`rm -rf`) at the end of the QA
run; no credential material appears in any file under this evidence directory.
