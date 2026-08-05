# Task 10 — Sandbox QA: skill→MCP reachability + single-skill discipline via fixture bridge

## What was tested

The end-to-end reachability of the already-shipped restricted Unity subagents
(todos 1/3/5/6/7) from a real, isolated opencode instance down to a bridge-shaped
MCP server — WITHOUT touching the real Unity bridge (port 27182, which is live on
this machine) and without using the real repo's `.omo/omo.jsonc`,
`.opencode/agents/`, or `packages/supermcp-skills/` as the project dir.

A throwaway **fixture MCP server** (`.local-ignore/qa/fake-mcp-server.mjs`,
gitignored) speaks streamable-HTTP MCP — the exact transport
`packages/mcp-client-core/src/skill-mcp-manager/http-client.ts` uses
(`StreamableHTTPClientTransport`) — on a RANDOM free port (never 27182). It exposes
four canned-response stub tools (`bridge_status`, `get_relevant_tools`,
`scene_list`, `list_pending_modals`) and appends an ordered, timestamped request
log so every tool call the agent made is recorded in call order.

A throwaway **fixture project dir** (`$SANDBOX/project/`) is the opencode project
dir, containing: (a) copies of the seven restricted agent `.md` files; (b) a minimal
`.omo/omo.jsonc` whose `"[opencode]"` `skills.sources` points at
`$SANDBOX/vendored-skills/` (a scratch copy of the six vendored skills) plus the
todo-8 `fallback_models`; (c) Unity project markers (`ProjectSettings/ProjectVersion.txt`,
`Assets/Scenes/`, `AGENTS.md`) so the primary agent recognizes a Unity project and
delegates. The real repo trees are only ever COPIED from, never used in place.

Scenarios driven (isolated XDG via `script/agent/qa-sandbox.sh`; plugin = built
`dist/index.js`):
- **(a)** `task(subagent_type="unity-scene", prompt="List the scenes in the project")`
- **(b)** `task(subagent_type="unity-editor", prompt="Domain: scene — List the scenes in the project")`
- **(c)** `task(subagent_type="unity-editor", prompt="make the game better")` (ambiguous)
- **(failpath)** scenario (a) with the fixture killed BEFORE the run

Per scenario the fixture starts on a fresh random port, all six scratch skill urls
are rewritten to it, opencode is driven with `opencode run --format json --auto`, and
the fixture PID is killed individually on teardown (rule #2598 — no unscoped pkill).

## What was observed

### Assertion table (expected call → observed evidence)

| # | Scenario | Expected | Observed | Verdict |
|---|----------|----------|----------|---------|
| 1 | (a) | unity-scene skill load ONLY (no second domain skill) | `skill_loads=["unity-scene"]` (`scenario-a/subagent-trail.txt`) | PASS |
| 2 | (a) | `skill_mcp(supermcp, bridge_status)` hits fixture | fixture `seq14 bridge_status` (`scenario-a/fixture-requests.jsonl`) | PASS |
| 3 | (a) | `get_relevant_tools` BEFORE any domain tool | fixture `seq16 get_relevant_tools` then `seq18 scene_list` | PASS |
| 4 | (a) | `scene_list` at fixture | fixture `seq18 scene_list` | PASS |
| 5 | (a) | order = bridge_status → get_relevant_tools → scene_list | exactly that order in the fixture log | PASS |
| 6 | (b) | `Domain: scene` maps to unity-scene ONLY | `skill_loads=["unity-scene"]` (`scenario-b/subagent-trail.txt`) | PASS |
| 7 | (b) | chain hits fixture | fixture `bridge_status` → `scene_list` (`scenario-b/fixture-requests.jsonl`) | PASS (see caveat) |
| 8 | (c) | ambiguous → `Status: blocked`, zero fixture requests | Depends on WHERE the block happens — see "Scenario (c): honest result" | PARTIAL / FINDING |
| 9 | (failpath) | fixture stopped → readable connection error, not a hang | `skill_mcp` returned `Failed to connect to MCP server "supermcp"... Unable to connect`; subagent returned `Status: blocked` (`scenario-failpath/`) | PASS |

### Scenario (a) — full PASS

`scenario-a/fixture-requests.jsonl` (tools/call, in order):
`bridge_status` (seq14) → `get_relevant_tools` (seq16) → `scene_list` (seq18).
`scenario-a/subagent-trail.txt`: exactly one skill load (`unity-scene`), then the
three `skill_mcp` calls in the same order. This is the canonical spec flow.

### Scenario (b) — PASS on discipline, model-variance on grounding order

Single-skill discipline held on every run: `Domain: scene` mapped to exactly
`unity-scene` (`skill_loads=["unity-scene"]`), and the fixture was reached. The
`bridge_status` / `get_relevant_tools` grounding preamble is NOT deterministic on
the fast `gemini-3.5-flash-lite` primary model: the captured run did
`bridge_status` → `scene_list` (skipped `get_relevant_tools`); an earlier repeat did
all three. The agent's *domain routing* is solid; the *grounding-order preamble* is a
soft instruction the fast model sometimes shortcuts. Recorded honestly rather than
cherry-picking the clean run.

### Scenario (c) — honest result (this is a real finding, not a clean PASS)

The plan's expectation ("`Status: blocked`, zero fixture requests") only holds
because of DEFENSE-IN-DEPTH at the OUTER primary agent, NOT because the
`unity-editor` agent's own ambiguity guard fires:

- When the outer primary (Sisyphus) is asked to forward "make the game better", it
  often **refuses to dispatch at all** (treats the terse relay instruction as a
  possible injection + judges the request too vague) → the `unity-editor` subagent
  is never spawned → zero fixture requests. That is how the literal criterion was
  first satisfied.
- When the vague prompt IS actually forwarded into `unity-editor` (reworded, less
  injection-shaped dispatch), the restricted agent on `gemini-3.5-flash-lite` does
  **NOT** emit `Status: blocked`. Across two runs (`scenario-c/subagent-trail-run1.txt`,
  `scenario-c-run2/`) it GUESSED a domain, loaded **two** skills
  (`unity-bridge-bootstrap` + `unity-scene`), and drove the fixture
  (`bridge_status`/`get_relevant_tools`/`scene_list`/`gameobject_get`).

**Conclusion:** the "ambiguous → blocked, zero fixture traffic" guarantee is
currently provided by the primary-agent layer, not by the `unity-editor` agent's own
"if the Domain line is missing or ambiguous, return Status: blocked without loading a
skill" instruction — the fast dispatch model ignores that instruction. This is a
prompt-adherence weakness in the restricted agent worth tightening (or worth relying
on the primary-layer guard by design). Filed as a finding for todo 12 / the F-wave.

### Failure-path — PASS

`scenario-failpath/`: the fixture was killed before the run. The agent loaded
`unity-scene`, called `skill_mcp(supermcp, bridge_status)`, and got a readable
connection error — `Failed to connect to MCP server "supermcp". URL:
http://127.0.0.1:52581/mcp Reason: Unable to connect.` — NOT a hang. It then returned
`Status: blocked` naming the offline bridge. This proves the skill_mcp HTTP client
surfaces a diagnostic error promptly when the bridge is down.

### Isolation proof

- Real DB path `~/.local/share/opencode/opencode.db`; sandbox DB under the mktemp
  `OMO_QA_ROOT/data/opencode/opencode.db`.
- A sample sandbox subagent session id resolves to **0 rows** in the real DB.
- `SELECT count(*) FROM session WHERE directory LIKE '%omo-qa-sandbox%'` on the real
  DB = **0** — no sandbox session leaked into the real store.
- The real DB session count moved 7032 → 7068 during the run; that delta is ambient
  activity from the live opencode this QA ran under (mailbox drains visible in the
  plugin log), NOT sandbox writes — proven by the two zero-row checks above, which
  are the authoritative isolation signal.

### Port safety

Every scenario bound a random free port (50902, 51061, 51957, 50079, 52581); none was
27182. The fixture hard-refuses to bind 27182 (`fake-mcp-server.mjs` exits 2), and
the rewrite script hard-refuses to rewrite skill urls to 27182.

## The skill-dedup shadowing gotcha — CONFIRMED live

Task 1 predicted it; this QA reproduced it. All six vendored skills declare the SAME
MCP server name `supermcp`. `skill_mcp(mcp_name="supermcp")` resolves that server name
across ALL currently-loaded skills, not just the one skill the agent loaded. In the
first (buggy) run only `unity-scene`'s scratch url was rewritten to the fixture; the
other five still pointed at `127.0.0.1:27182`. Result: `list_mcp_resources` reached the
fixture, but `skill_mcp bridge_status` resolved `supermcp` via a sibling skill and hit
the REAL bridge on 27182 (which answered `No Unity Editor instance is registered`).

**Fix that makes the fixture authoritative:** rewrite the `supermcp` url in ALL SIX
scratch skills to the fixture port (`rewrite-all-urls.mjs`), not just `unity-scene`.
After that, every `skill_mcp(supermcp, …)` call landed on the fixture. This is the
concrete, reproduced confirmation of the dedup/shared-server-name caveat, and the
reason a sandbox QA must own EVERY vendored skill's url, not just the one under test.

## Why this is enough

The fixture speaks the real MCP transport the plugin's skill-mcp HTTP client uses, so
the connection, protocol handshake, and per-session client keying are all real — only
the tool responses are canned. The four scenarios cover the full task-10 matrix:
single-skill discipline (a/b), the ordered bridge_status→get_relevant_tools→scene_list
chain (a), Domain-line routing (b), the ambiguity path (c), and the offline-bridge
failure mode (failpath). Every expected call is cross-referenced to an ordered fixture
log line and to the subagent's DB tool trail. Isolation is proven by session-id and
directory absence in the real DB, not by a raw count.

## What was omitted / residual risk

- Real-model spend was minimized (cheapest configured provider, short prompts, a few
  dispatches). No attempt to exhaust the fallback chain.
- Grounding-order determinism (b) and the ambiguity-block adherence (c) are
  model-behavior observations on `gemini-3.5-flash-lite`; a stronger fallback model may
  behave differently. Recorded as findings, not hard failures of the wiring.
- The fixture returns success for `list_pending_modals` but no scenario exercised the
  modal-dismiss path (out of task-10 scope).
- Raw secret-bearing logs were not copied; the host `auth.json` was copied READ-ONLY
  into the isolated data dir only so models resolve, and is under the mktemp sandbox
  (removed with `rm -rf "$OMO_QA_ROOT"`).

## Artifacts

- `scenario-a/`, `scenario-b/`, `scenario-c/`, `scenario-c-run2/`, `scenario-failpath/`:
  each holds `fixture-requests.jsonl` (ordered log), `transcript.jsonl` (primary
  `opencode run` json), `subagent-trail*.txt` (subagent tool order from the sandbox DB),
  `url-rewrite.txt`, `fixture-port.txt`, `run.log`.
- `fixture-scripts/`: byte copies of the gitignored fixture harness
  (`fake-mcp-server.mjs`, `setup-sandbox.sh`, `run-scenario.sh`, `rewrite-all-urls.mjs`,
  `smoke-client.mjs`) so the evidence is self-contained even though `.local-ignore/` is
  never committed.
