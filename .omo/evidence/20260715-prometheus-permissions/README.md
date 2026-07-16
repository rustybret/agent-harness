# Prometheus permission granularization + AFT mutation-tool gating — QA evidence

Date: 2026-07-15
Change: packages/omo-opencode/src/plugin-handlers/tool-config-handler.ts (prometheus permission block)
Cross-project audit source: aft project (mailbox note 96ebf017), findings #1 + #2. User-approved with 2 conditions.

## WHAT WAS TESTED
1. Unit (RED->GREEN): tool-config-handler-prometheus-permissions.test.ts (23 cases) asserting the
   permission SHAPE applyToolConfig() produces: bash as granular object ("*":deny first, scaffold/git/just
   allows after), interactive_bash + 6 AFT mutation tools flat-denied, 10 sensory tools untouched, other
   agents unaffected. RED first (10 fail: aft tools undefined, bash flat-deny), GREEN after impl (23 pass).
2. Regression: full plugin-handlers suite (247 pass) incl. updated display-name test (flat-deny contract ->
   granular-deny contract, same behavioral intent). prometheus-md-only hook suite (39 pass). typecheck clean.
3. LIVE real-surface (live-permission-decision.txt): drives OpenCode CORE's REAL permission engine
   (fromConfig/disabled/evaluate, reimplemented byte-for-byte from
   opencode-build/packages/opencode/src/permission/index.ts, Wildcard.match semantics verified against
   packages/opencode/src/util/wildcard.ts) against the REAL applyToolConfig() output.

## WHAT WAS OBSERVED (live-permission-decision.txt — VERDICT: ALL PASS, exit 0)
- #1 bash VISIBLE (disabled() does not hide it — last bash rule is a non-"*" allow).
- #1 exec gate 9/9: node scaffold-plan.mjs / git log|diff|status / just --list = ALLOW;
  rm -rf / curl / echo>/etc/passwd / npm install = DENY.
- #2 hidden: interactive_bash, aft_delete, aft_move, aft_refactor, aft_import, ast_grep_replace, aft_safety.
- COND1 kept visible: aft_search/outline/zoom/callgraph/inspect/conflicts, ast_grep_search, lsp_*.

## WHY IT IS ENOUGH
The live harness IS OpenCode's own decision logic (verbatim source parity confirmed), fed the exact ruleset
our handler emits. It proves the user-visible outcome — which tools Prometheus sees and which bash commands
run — not merely that our test mirrors our code. The subtle findLast/"*"-ordering nuance the aft note flagged
for a regression test is asserted in both the unit suite (ordering test) and the live visibility check.

## WHAT WAS OMITTED
No full TUI model-driven session: the behavior is a pure permission-ruleset transform with zero model
involvement, so a live LLM session would add flakiness without adding proof. The core-engine harness is the
deterministic ground truth. No secrets/tokens are present in any artifact.

## HARDENING (post-reviewer-gate, all 3 concerns resolved)
Reviewer (ultrabrain) BLOCKED the first pass with 3 criterion-cited concerns; all verified real against
opencode-build source and fixed:

1. apply_patch (S3): asserts action:"edit" (apply-patch.ts:117,192 Tool.withPermission "edit"), so a permission
   deny is INERT and disabled() remaps apply_patch->edit. The live harness caught this (test mirror missed it).
   FIX: gate via prometheus-md-only hook — new patch-targets.ts extractPatchTargets() parses "*** Add/Update/
   Delete File:" + "*** Move to:" headers; hook rejects if ANY target escapes .omo/*.md (mixed-hunk safe).
2. lsp_rename + lsp_install_decision (S3/cond1): real mutating fork tools (lsp-tools-mcp). FIX: flat-denied ->
   HIDDEN. Read-only lsp_* (diagnostics/goto/refs/symbols/prepare_rename/status) stay visible.
3. bash over-permissive (S2): OpenCode bash matches the WHOLE raw command string (bash.ts:142-149,
   resources:[input.command], no shell parse). FIX: shell-metachar deny layer AFTER the allows
   (; & | > < backtick $( newline) + quote-anchored node allow. findLast picks the deny for any injection while
   the last non-"*" rule keeps bash VISIBLE.

Live verdict after hardening (live-permission-decision.txt): ALL PASS — bash visible, 17/17 exec-gate correct
(6 legit allow, 11 injection/arbitrary deny), all mutators + interactive_bash + lsp_rename + lsp_install_decision
hidden, 13 sensory tools (incl. lsp_symbols/prepare_rename/status) visible. apply_patch shown visible here but is
blocked at the hook layer (edit-remapped), proven in prometheus-md-only/index.test.ts (43 pass).

## HARDENING ROUND 2 (reviewer found 2 verified bypasses in the git/just/node allows)
Reviewer round-2 BLOCK — both bypasses verified real:
1. node option injection: `node "--eval=...//scaffold-plan.mjs" x` matched `node "*scaffold-plan.mjs" *`
   (the `*` before the filename swallowed `--eval`); node executes the --eval code.
2. git flag mutation: `git diff --output=package.json` / `git log --output=package.json` write files via
   git's OWN --output flag; also `git -c core.pager=<cmd>` is RCE. No shell metachar needed.
Root lesson: an executable cannot be safely prefix-allowlisted — its own flags are an unbounded surface.
FIX:
- DROP git/just entirely. Prometheus keeps the aft_*/lsp_* read-only sensory surface for research.
- NODE allow anchored to `/` immediately after the quote: `node "/*/scaffold-plan.mjs"*` — an option can
  never be the effective first arg (must be an absolute path). Belt-and-suspenders: deny node code-exec
  long-options (--eval/--print/--require/--import/--loader/--experimental) after the allow.
- Keep shell-metachar deny layer.
Live verdict (live-permission-decision.txt): ALL PASS — 19/19 exec-gate (3 scaffold allow; both reviewer
bypasses + git -c core.pager + dropped git/just + node --eval/--import + metachar + arbitrary all DENY),
bash VISIBLE, mutators + interactive_bash + lsp_rename + lsp_install_decision HIDDEN, 13 sensory tools visible.

## REVIEWER VERDICT: APPROVE (round 3)
No bypass found against `node "/*/scaffold-plan.mjs"*` + metachar + node-long-option deny layers.
Trailing flags after the script path are script-argv (not node options), so `-e`/`-r` after the path do NOT exec.

### Accepted residual risk (non-blocking, documented per reviewer)
The node allow trusts any existing absolute path whose basename is `scaffold-plan.mjs`. A hostile pre-existing
file with that exact basename could be pointed at. NOT blocked because: (a) Prometheus write is gated to
.omo/*.md (cannot create a .mjs), (b) apply_patch is hook-gated the same way, (c) it's an existing-filesystem
trust assumption shared by any script-allowlist. Future hardening: pin to the resolved bundled skill script path.
