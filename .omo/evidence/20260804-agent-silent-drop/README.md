# Agent silently dropped by an unsupported model

## What was tested

Whether a user can discover that an agent has been removed from every session because the model
they configured for it is refused by that agent.

Surface driven: the real `doctor` CLI (`bun packages/omo-opencode/src/cli/index.ts doctor --json`)
against an isolated `HOME` containing `.omo/omo.jsonc` with
`[opencode].agents.hephaestus.model = "anthropic/claude-opus-5"`, plus the real registration
function `maybeCreateHephaestusConfig` invoked directly
(`.local-ignore/qa/hephaestus-silent-drop-driver.mjs`).

Behavior it was meant to prove: doctor's report agrees with what registration actually does.

## What was observed

Registration path, three models through the real `maybeCreateHephaestusConfig`:

| configured model | agent registered |
|---|---|
| `openai/gpt-5.6-sol` | yes |
| `anthropic/claude-opus-5` | **no** |
| `openai/gpt-4o` | **no** |

Doctor, same `anthropic/claude-opus-5` config (`before-doctor-unsupported.json` vs
`after-doctor-unsupported.json`):

| | before | after |
|---|---|---|
| Models check status | `warn` | `fail` |
| error-severity issues | 0 | 1 |
| hephaestus detail line | `● hephaestus: anthropic/claude-opus-5 (medium) [capabilities: snapshot-backed]` | same + `✗ NOT LOADED (requires GPT-5.3 Codex, GPT-5.4, GPT-5.5, or GPT-5.6)` |

Before, doctor reported the refused model as the agent's effective model with zero issues, so the
only trace of the dropped agent was one line in `$TMPDIR/oh-my-opencode.log`. After, doctor names
the agent, the requirement, the configured model, and the fix.

## Why it is enough

The evidence drives the real CLI end to end rather than the check function in isolation, and the
before-capture comes from the same command against the same config with only the fix reverted, so
the delta is attributable. A regression test
(`model-resolution.test.ts`, "matches the registration path") calls BOTH
`maybeCreateHephaestusConfig` and the doctor collector in one test and asserts they agree, which
pins the invariant that made this defect possible: the two paths had independent copies of the
rule. Both now read `AGENT_MODEL_CONSTRAINTS`.

Residual risk: only hephaestus declares a constraint today. Another agent that starts refusing
models must add a registry entry, or it will drop silently the same way. The registry test asserts
every declared constraint carries a human-readable requirement, but it cannot detect an agent that
never registered one.

## What was omitted

The isolated `HOME` was a `mktemp` dir; no real `~/.omo/omo.jsonc` was read or written. No secrets
appear in the captured output. Running the CLI regenerated the build artifact
`packages/omo-senpi/plugin/extensions/omo.js`, which was reverted rather than committed.

## Correction to prior knowledge

Constraint #1984 recorded `openai/gpt-5.6-sol` as an unsupported Hephaestus model. That is no
longer true: a `gpt-5.6` regex was added to `packages/omo-opencode/src/agents/hephaestus/agent.ts`,
and the driver confirms the agent registers on it. The silent-drop behavior it described is real
and reproducible with `anthropic/claude-opus-5` or `openai/gpt-4o`.
