# QA evidence — migrated `agents.*.models` was silently dropped at runtime

Date: 2026-08-03
Change: `packages/omo-opencode/src/config/schema/` + `plugin-config/unknown-key-diagnostics.ts` —
accept the canonical agent `models` chain and unpack it into `model` + `fallback_models`.
Roadmap item: P0-2 in `.omo/plans/tooling-improvement-roadmap.md`.

## What was tested

The real config validation path against the developer's actual live `~/.omo/omo.jsonc`, which the
2026-08 reasoning-unification migration had already rewritten in place:

    validatePluginConfig(root)
      -> loadOmoOpenCodeConfigChain
        -> OhMyOpenCodeConfigSchema.safeParse   (does the chain survive parsing?)
        -> findUnknownKeyPaths                  (is a real typo still reported?)
    readView(root)                              (what does the TUI sidebar render?)
    oh-my-openagent doctor                      (what does the user-facing CLI report?)

This was found while QA'ing an unrelated change: `readView` on a fixture repo returned
`kind: "broken"` with eleven `Unknown config key: agents.<name>.models` messages sourced from the
developer's own user config — not from the fixture.

## What was observed

The migration collapses an agent's `model` + `variant` + `fallback_models` into one ordered `models`
array (`config-migration/reasoning-unification.ts`, `normalizeDefinition`), matching the category
shape. `AgentOverrideConfigSchema` never had a `models` field, and since it is a non-strict Zod
object, the key was dropped rather than rejected — so every migrated agent parsed to `{}`.

Before the fix — `before.json`, `doctor-before.txt`:

    configValid: false
    11 "Unknown config key: agents.<name>.models" messages
    all 11 agents:  model: null,  fallbackCount: 0
    doctor: 11 "Invalid configuration" issues

After the fix — `after.json`, `doctor-after.txt`:

    configValid: true
    0 unknown-key messages
    atlas -> claude-sonnet-5 (7 fallbacks), oracle -> antigravity-gemini-3.1-pro (5),
    sisyphus -> claude-sonnet-5 (4), sisyphus-junior -> claude-sonnet-5 (16), ... 11/11 resolved
    doctor: 0 "Invalid configuration" issues (1 unrelated legacy-config-migration notice remains)

Impact: this was not cosmetic. Every agent silently fell back to built-in defaults, so the user's
entire configured model selection and fallback chains — 11 agents, 77 fallback entries — were inert
at runtime while the config file looked correct on disk.

A second defect surfaced during the fix. `findUnknownKeyPaths` unwrapped a `pipe` through its `in`
side; `z.preprocess` compiles to a pipe whose `in` is the *transform*, which has no shape, so
traversal stopped there and every nested key under a preprocessed schema was silently un-diagnosed.
That already affected `categories.*` upstream of this change. `unknown-key-diagnostics.ts` now
traverses a preprocessed schema through its output object. Verified both directions: a genuine typo
(`agents.oracle.modle`) is still reported, and the legitimate `models` chain is not.

## Verification run

- `bun test` — 13682 pass / 0 fail (the one failure seen mid-change was
  `tests/omo-schema-freshness.test.ts` demanding the regenerated asset; `bun run build:schema` was
  run and the asset diff contains only the new per-agent `models` field).
- `bun run typecheck` — clean.
- `lsp_diagnostics` — clean on all four changed/added files.

## Isolation

No opencode process was spawned and no session DB was touched. The config path is read-only against
`~/.omo/omo.jsonc`; the driver and the doctor run both only read. The before/after pair was produced
by stashing and restoring the two production source files, so the delta is attributable to the change
alone. Reading the developer's real config was the point of the test — the bug only reproduces
against a config the migration has actually rewritten.

## Why this is enough

The assertion is on the values the plugin actually resolves per agent (`model`, fallback count) and
on the user-facing `doctor` output, not on the schema in isolation, and it runs against a real
already-migrated config rather than a synthetic one. Unit coverage in
`config/schema/agent-models-canonical.test.ts` pins the unpack semantics: string chains, object
primary with hoisted settings, single-entry chains, explicit `model`/`fallback_models` winning over
the chain, the `hephaestus` extended shape, and catchall-named agents.

Residual risk: an explicit `model` alongside a `models` chain now overrides `models[0]` and takes the
tail as fallbacks. That reading follows the documented "first entry is the primary" contract, but a
config carrying both is ambiguous by construction; the migration never emits that shape.

## What was omitted

`before.json` / `after.json` list agent names and model ids from the developer's config; these are
provider/model identifiers, not credentials. No API keys, tokens, auth headers, or mailbox grant
tables are included — an earlier exploratory probe that printed live mailbox grants was not written
to disk.
