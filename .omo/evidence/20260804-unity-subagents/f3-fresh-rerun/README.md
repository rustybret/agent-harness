# F3 — Fresh Manual QA Re-run (independent re-execution of task-9 + task-10)

Plan: `.omo/plans/unity-supermcp-subagents.md` Final Verification Wave **F3**.
This is a from-scratch, independent RE-EXECUTION of the task-9 and task-10 sandbox
probes — NOT a re-read of the existing `task-9/` or `task-10/` evidence. Every probe
below ran in a **fresh `mktemp` XDG sandbox** on **fresh ports**, driving a **real**
isolated opencode (v1.18.11, bun 1.3.12, macOS), plugin build `dist/index.js`
(2026-08-04 18:31). The real `~/.local/share/opencode/opencode.db` was only ever READ.

Run marker (embedded in every dispatch prompt so the real-DB negative query is
specific to THIS run): `f3fresh-20260804-195145-32494`.

Driver scripts (gitignored) under `.local-ignore/qa/unity-f3-fresh/`
(`registration-probe.sh`, `denial-probe.sh`, `fixture-run.sh`, `eval-permissions.mjs`);
the shared fixture MCP server + url-rewriter are reused byte-for-byte from
`.local-ignore/qa/` (`fake-mcp-server.mjs`, `rewrite-all-urls.mjs`) — re-run fresh,
not replayed. Raw artifacts under `raw/`.

---

## WHAT WAS TESTED

Four fresh probes, each in its own fresh sandbox:

- **(1) REGISTRATION + PERMISSION** — fresh isolated `opencode serve` on a fresh free
  port (65357), bootstrap `GET /agent?directory=<repo>` (lazy plugin init, memory
  #2092), capture the full `/agent` JSON; assert all 8 unity agents register
  non-hidden and each restricted agent's effective permission map (real last-match-wins
  over the ordered permission array) equals the todo-5/6/7 spec.
- **(2) PERMISSION DENIAL** — fresh `task(subagent_type="unity-editor")` bash-only
  dispatch; assert bash is STRIPPED from the child toolset. Differential: SAME
  instruction via unrestricted `task(subagent_type="unity-gamedev")`; assert bash
  EXECUTES.
- **(3) SKILL REACHABILITY + SINGLE-SKILL DISCIPLINE** — NEW fixture MCP server on a
  FRESH port (50794), ALL SIX scratch skill urls rewritten to it (task-10 shadowing
  gotcha: all six share MCP server name `supermcp`), clean single-domain scenario
  `task(subagent_type="unity-scene", "List the scenes in the project")`; assert one
  skill load and `bridge_status → get_relevant_tools → scene_list` hit the fixture.
- **(4) AMBIGUOUS DOMAIN** — fresh fixture (port 51092), `task(subagent_type=
  "unity-editor", "make the game better")`; record what actually happens vs the prior
  task-10 finding.

---

## WHAT WAS OBSERVED

### Isolation proof (real DB untouched) — PROVEN

- Real DB `~/.local/share/opencode/opencode.db`: BEFORE=**7081**, AFTER=**7085**
  (`raw/real-db-session-count-{BEFORE,AFTER}.txt`). The +4 delta is **ambient** (this
  QA runs inside a live opencode session writing the real DB) and is **NOT** the
  authoritative signal.
- **Authoritative negative queries** (`raw/isolation-proof.txt`):
  - real-DB rows matching the fresh run marker / `f3fresh` directory = **0**
  - real-DB rows with directory under `omo-f3fresh-*` sandbox = **0**
  - of the **8** sandbox session ids collected across all three sandboxes, **0** leaked
    into the real DB (per-id `SELECT count(*)` each returned 0; explicit spot-checks on
    the restricted-editor child, the scene child, and the ambiguous child all = 0).
  - Pre-run baseline confirmed 0 marker hits BEFORE the run
    (`raw/real-db-marker-hits-BEFORE.txt`).
  → `ISOLATION: PROVEN — zero fresh-run sessions leaked into the real db`.

### (1) Registration + permission — PASS

- `raw/reg-agent-presence.txt`: all 8 unity agents present, none hidden —
  `unity-editor`, `unity-scene`, `unity-script-roslyn`, `unity-asset`, `unity-build`,
  `unity-runtime`, `unity-bridge-bootstrap`, `unity-gamedev` (each `present=1
  hidden=unset`).
- `raw/reg-effective-permissions.txt` (real last-match-wins over the ordered permission
  array): **ALL 7 restricted agents match the spec EXACTLY** — `*`:deny +
  skill/skill_mcp/read/question/todowrite:allow + bash/edit/write/task/webfetch/
  websearch:deny (12/12 tool resolutions each). Overall:
  `ALL 7 RESTRICTED AGENTS MATCH SPEC`.
- Control `unity-gamedev`: `*`:allow, bash/edit/write:allow (unrestricted).
- Full JSON: `raw/reg-agent-list.json` (~531 KB), maps in
  `raw/reg-agent-permission-maps.json.txt`.

### (2) Permission denial + differential — PASS

The restricted permission map is a subagent-dispatch-time control (enforced via
`task(subagent_type=...)`).

- **Restricted `unity-editor` child** (`raw/deny-task-unity-editor.jsonl`,
  child `ses_030278f6effeROCbhBSocG9es1`): **0** bash tool-parts in the child session
  (`raw/deny-editor-bashcount.txt`). The child self-reports
  (`raw/deny-editor-child-selfreport.txt`):

  > "I cannot use the `bash` tool because it is not declared or available in my current
  > tool definitions or permission map (as a restricted subagent, execution tools like
  > `bash` are denied). The tools that ARE available to me are: call_omo_agent,
  > list_mcp_resource_templates, list_mcp_resources, read, read_mcp_resource, skill,
  > skill_mcp, todowrite"

- **Control `unity-gamedev` child** (`raw/deny-task-unity-gamedev.jsonl`,
  child `ses_030271eb0ffec26s6gQOBOS6p0`): bash tool-part `status=completed`, count
  = **1** (`raw/deny-gamedev-bashcount.txt`). Bash EXECUTED.

  → the restriction is agent-specific (the permission map), not sandbox-wide. Confirms
  task-9 (b).

### (3) Skill reachability + single-skill discipline (unity-scene) — PASS

`raw/scenario-scene/` — fixture port **50794** (fresh):

- ALL SIX scratch skill urls rewritten to the fixture (`url-rewrite.txt`:
  `total skills rewritten: 6`).
- Exactly **one** skill load: `unity-scene` (`subagent-trail.txt`).
- Fixture ordered call log (`fixture-callorder.txt`):
  `14 bridge_status → 16 get_relevant_tools → 18 scene_list` — the canonical spec order.
- Subagent `skill_mcp` trail: `bridge_status → get_relevant_tools → scene_list →
  session_changes`, all `status=completed`, all against `mcp=supermcp`.
- Subagent returned `Status: done`, correctly reporting the two fixture scenes.
- Reproduces task-10 scenario (a) FULL PASS.

### (4) Ambiguous domain (unity-editor "make the game better") — REPRODUCES task-10 FINDING

`raw/scenario-ambiguous/` — fixture port **51092** (fresh):

- The restricted `unity-editor` agent on `gemini-3.5-flash-lite` did **NOT** emit
  `Status: blocked`. It **guessed**, loaded **two** skills (`unity-bridge-bootstrap`
  + `unity-scene`, `subagent-trail.txt`), and drove the fixture
  (`bridge_status → scene_list → get_relevant_tools ×2 → gameobject_get →
  list_custom_tools → bridge_status`, `fixture-callorder.txt`; 5 tools/call requests).
  Final output was an unsolicited multi-point "make it better" improvement plan, not a
  block.
- **This CONFIRMS the prior task-10 scenario (c) finding**: the restricted agent's own
  "missing/ambiguous Domain → `Status: blocked` without loading a skill" instruction is
  NOT reliably honored by the fast dispatch model. The "ambiguous → blocked, zero
  fixture traffic" guarantee therefore rests on the OUTER primary-agent guard
  (defense-in-depth), not on the restricted agent's own ambiguity guard. In this fresh
  run the primary DID forward the vague prompt, so the inner-guard weakness was exposed
  exactly as task-10 predicted (this REFUTES any reading that the inner guard fires —
  it does not).

### Port safety — PASS

Fresh fixture ports **50794** and **51092**: neither is 27182, and neither collides
with any task-10 port (50902/51061/51957/50079/52581) — the runner hard-avoids all of
them and 27182. Port 27182 remained bound by the pre-existing real bridge `beam.smp`
(PID 22568), which we never touched. All tracked PIDs (serve 50928, fixtures 59306 /
60231) were killed individually (rule #2598) and confirmed dead post-run.

---

## WHY IT IS ENOUGH

- Every probe is a genuine fresh execution against a real isolated opencode: fresh
  mktemp sandboxes, fresh serve port, fresh fixture ports, fresh sessions embedding a
  unique run marker — none of the task-9/task-10 artifacts were replayed.
- Registration + effective permissions are read from opencode's authoritative `/agent`
  API and evaluated with the real last-match-wins algorithm (12/12 resolutions × 7
  agents), not paraphrased from `.md` frontmatter.
- Denial is proven at the real enforcement layer two ways (the child's own
  tool-definition self-report AND zero bash parts in the child session DB), with the
  unrestricted control executing the identical instruction isolating the cause to the
  permission map.
- Skill→MCP reachability uses the real streamable-HTTP MCP transport the plugin's
  skill-mcp HTTP client uses; only the tool responses are canned. Every expected call
  is cross-referenced to an ordered fixture log line and the subagent's DB tool trail.
- Isolation is proven by specific negative queries (marker, sandbox directory, and
  per-session-id absence in the real DB), which is stronger than the ambient raw
  before/after delta.

## VERDICT: APPROVE

The fresh, independent re-run reproduces every claimed behavior:
- registration (8 agents, none hidden) — reproduced;
- effective permission spec (7 restricted agents, 12/12) — reproduced;
- permission denial + unrestricted differential — reproduced;
- single-skill discipline + ordered bridge chain (unity-scene) — reproduced (full PASS);
- ambiguous-domain — reproduced the task-10 FINDING (restricted agent's own ambiguity
  guard is NOT honored by the fast dispatch model; the guarantee comes from the primary
  layer). This is a faithful reproduction of a self-disclosed, non-blocking finding, not
  a new regression.

Isolation from the real DB is proven. No Must-NOT-Have was violated (no 27182 binding,
PIDs killed individually, real DB read-only).

## WHAT WAS OMITTED

- No live Unity Editor / SuperMCP bridge driving (the fixture stands in for the bridge;
  27182 never bound by us — it belongs to the pre-existing `beam.smp`). Live-editor
  behavior remains the gated benchmark (todo 11), out of F3 scope.
- Real-model spend minimized: short prompts, few dispatches; no fallback-chain
  exhaustion.
- Grounding-order determinism (scenario-scene did the full ordered chain this run) and
  ambiguity-block adherence are model-behavior observations on `gemini-3.5-flash-lite`;
  a stronger fallback model may differ. Recorded as reproduced findings, not wiring
  failures.
- No secret-bearing logs copied; host `auth.json` was copied READ-ONLY into the
  isolated data dirs only so models resolve, under the mktemp sandboxes (removed with
  the sandbox roots).
