# Task 15 Evidence: mailbox cipher relay E2E harness

## What was tested

- Built manual harness files under `test-support/e2e/mailbox-cipher-relay/`.
- Ran `bun test-support/e2e/mailbox-cipher-relay/cli.ts --self-test`.
- Ran `bunx tsgo --noEmit --ignoreConfig --target ESNext --module ESNext --moduleResolution bundler --strict --types bun-types --skipLibCheck --allowArbitraryExtensions test-support/e2e/mailbox-cipher-relay/*.ts`.
- Ran `bun run typecheck`.
- Ran `bun test`.
- Ran `bun run build`.
- Ran OpenCode QA smoke: `bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check && bash .agents/skills/opencode-qa/scripts/server-smoke.sh --self-test`.

## What was observed

- Self-test exited 0.
- Correct arbiter report passed with expected and actual sentence `atlas lumen willow delta onyx zephyr glimmer ribbon cascade juniper`.
- Wrong arbiter report failed as expected with actual sentence ending in `wrong`.
- Isolation proof passed: real registry `/Users/brethoffman/.omo/project-registry.json` hash stayed `26d4e237d2dabffed6662d64e9737b72245f96e1cefd693a20a349c71984ad71` before and after.
- External-mode assertion passed using sandbox presence records with `mode: "external"`.
- New-file typecheck command exited 0.
- `bun run typecheck` exited 0.
- `bun test` exited 0: 13111 pass, 7 skip, 0 fail, 13118 tests across 1632 files. This confirms the manual harness was not discovered by the default test glob and did not spin up live relay serve instances.
- `bun run build` exited 0.
- OpenCode QA smoke exited 0. It verified script dependencies, isolated XDG sandbox cleanup, isolated HOME, `/global/health`, `/doc`, and authenticated server behavior without mutating the real DB.
- During verification, `bun test` initially caught an existing production adapter audit offender: raw `bun:sqlite` import in `sqlite-todo-writer.ts`. I fixed it by adding the approved `bun-sqlite-shim.ts` dynamic loader and routing todo injection through that shim, then re-ran typecheck, default tests, build, and OpenCode QA successfully.

## Why it is enough

- The self-test exercises fixture generation, sandbox XDG and `OPENCODE_DB` isolation, registry injection, envelope serialization, parameterized hop modes, final file-drop validation, correct-result acceptance, wrong-result rejection, and real-registry non-mutation without live models.
- Live model execution is intentionally left to task 16. This task provides the generator, driver seam, seed command, external-mode assertion, and arbiter command that task 16 can use against real `opencode serve` instances.

## What was omitted

- No real LLM sessions were started.
- No paid model was used.
- No secret-bearing logs or environment dumps were copied.
