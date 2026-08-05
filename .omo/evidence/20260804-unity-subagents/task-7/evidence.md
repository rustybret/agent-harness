# Task 7 Evidence — Option B agents (unity-build / unity-runtime / unity-bridge-bootstrap)

Date: 2026-08-04
Scope: create three restricted Unity domain subagents under `.opencode/agents/`.

## Files created

- `.opencode/agents/unity-build.md`
- `.opencode/agents/unity-runtime.md`
- `.opencode/agents/unity-bridge-bootstrap.md`

Sibling task-5 template used for consistency: `.opencode/agents/unity-editor.md`
(pre-existing at start of this task; NOT modified).

## WHAT WAS TESTED

1. YAML frontmatter parses for all three files.
2. `permission` + `mode` + `model` + `temperature` block is BYTE-IDENTICAL
   across all three (and to the sibling `unity-editor.md`).
3. Each body loads exactly ONE fixed skill as its first action.
4. Each body has an out-of-domain `Status: blocked` hand-off rule (no second skill).
5. Domain-specific caveats present per the plan's acceptance criteria.
6. No body instructs use of `bash`, `edit`, `write`, or `aft_*` tools.
7. Required literal tool-name grep hits: `build_select_target`,
   `scene_wait_for_start`, `checkpoint_create`.

## WHAT WAS OBSERVED

### Byte-identical frontmatter config block (sha256 of mode→end-of-frontmatter)

```
unity-build.md:            871811709937957c99dfba3981034fb1c9b4b76fb8b29b1ab0a33fd5e49f4001
unity-runtime.md:          871811709937957c99dfba3981034fb1c9b4b76fb8b29b1ab0a33fd5e49f4001
unity-bridge-bootstrap.md: 871811709937957c99dfba3981034fb1c9b4b76fb8b29b1ab0a33fd5e49f4001
unity-editor.md (sibling): 871811709937957c99dfba3981034fb1c9b4b76fb8b29b1ab0a33fd5e49f4001
```

All four identical. Block content:

```yaml
mode: subagent
model: opencode/gemini-3.5-flash-lite
temperature: 0.1
permission:
  "*": deny
  skill: allow
  skill_mcp: allow
  read: allow
  question: allow
  todowrite: allow
```

### YAML parse check (bun + yaml)

```
unity-build.md:            OK mode=subagent model=opencode/gemini-3.5-flash-lite temp=0.1 perm.keys=6
unity-runtime.md:          OK mode=subagent model=opencode/gemini-3.5-flash-lite temp=0.1 perm.keys=6
unity-bridge-bootstrap.md: OK mode=subagent model=opencode/gemini-3.5-flash-lite temp=0.1 perm.keys=6
```

### Single-skill-load rule (first action)

```
unity-build.md:            skill(name="unity-build")
unity-runtime.md:          skill(name="unity-runtime")
unity-bridge-bootstrap.md: skill(name="unity-bridge-bootstrap")
```

Each body contains an "## Out-of-Domain Rule" section instructing
`Status: blocked` with the correct sibling agent name, and "Never load a second
domain skill in the same run."

### Required literal grep hits (plan acceptance criteria)

```
build_select_target -> unity-build.md            OK
scene_wait_for_start -> unity-runtime.md          OK
checkpoint_create    -> unity-bridge-bootstrap.md OK
```

### Domain-caveat coverage

- **unity-build.md:** `build_select_target` BEFORE `build_invoke` sequencing;
  ~31s HTTP timeout caveat (build continues in Unity, poll `build_get_report`,
  `available: false` = no completed build since domain reload).
- **unity-runtime.md:** play-mode safety (save scenes before `play_mode_enter`);
  pause/step semantics (`play_mode_pause` / `play_mode_step`); profiler
  start→capture→stop→exit sequencing; async watch via
  `scene_wait_for_start` → `scene_wait_for_result` (never busy-poll);
  `game_invoke_action` failure modes (`registry_empty` / `action_not_found` /
  `no_instance`).
- **unity-bridge-bootstrap.md:** bridge health (`bridge_status`, pump telemetry
  `last_pump_tick_age_ms`, `focus_editor`); package install; `checkpoint_create`
  / `checkpoint_restore` before risky work; permission tiers
  (`set_permission_tier` observe/standard/unrestricted); `batch_execute`;
  modal-handling ownership (`list_pending_modals` / `dismiss_modal`);
  `request_user_decision` / `record_decision`.

### Forbidden-tool grep (bodies, frontmatter stripped)

```
unity-build.md:            CLEAN
unity-runtime.md:          CLEAN
unity-bridge-bootstrap.md: CLEAN
```

No `bash`, `edit`, `write`, or `aft_*` tool instructions in any body. (An
initial pass flagged the domain phrase "C# script create/edit" in the
hand-off table; reworded to "C# script authoring" so the grep is strictly
clean without changing routing intent.)

## WHY IT IS ENOUGH

The plan's acceptance criteria for todo 7 are: (a) three files exist with the
byte-identical restricted permission/mode/model/temperature block, (b)
single-skill-load-first + out-of-domain blocked rule, (c) the three required
literal tool names appear, (d) forbidden-tool grep is clean, (e) domain-specific
caveats match the SKILL.md source. Every one is demonstrated above with a
reproducible command output. Tool names and sequencing were taken verbatim from
the vendored SKILL.md sources (`packages/supermcp-skills/skills/unity-*/`), so
the guidance matches the live bridge surface.

## WHAT WAS OMITTED

No secrets, tokens, or env dumps are involved in this change (static markdown
agent definitions only). No live bridge / Unity Editor was driven — these are
declarative agent config files, not harness-connected runtime code, so the QA is
static structural verification (parse + grep + hash), which is the appropriate
gate for this artifact type.
