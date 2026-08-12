# QA Evidence: Unity Planning Guidance (Item 10)

Date: 2026-08-12
Target Task: Prometheus Planning Guidance & ulw-plan Unity Subagent Routing

## WHAT WAS TESTED
1. **Bundled Prometheus Prompt Inlining & Dist Signature Preservation:**
   - Ran `bun run build` to compile `dist/index.js`.
   - Executed `bun test packages/omo-opencode/src/shared/dist-bundle-prompt-content.test.ts` to confirm that Prometheus prompt changes are correctly inlined into the distribution bundle and that the pinned signature (`"Your FIRST action in every planning session is to LOAD the ulw-plan skill"`) remains intact.
   - Asserted that `dist/index.js` contains `unity-script-roslyn`.
2. **Runtime Skill-Loader Discovery:**
   - Executed a Bun evaluation script calling `discoverSharedSkills()` from `packages/skills-loader-core/src/features/opencode-skill-loader/loader.ts`.
   - Verified that the resolved `ulw-plan` skill's `references/full-workflow.md` file contains `Domain-specialized executor routing (Unity)` and `subagent_type: "unity-script-roslyn"`.

## WHAT WAS OBSERVED
- `dist-bundle-prompt-content.test.ts` passed 100% (1 pass, 0 fail).
- Inlined string check in `dist/index.js` returned `true`.
- Runtime `discoverSharedSkills()` check returned `has_section: true` and `has_roslyn: true`.
- TDD content-pin test suites `packages/prompts-core/src/prometheus-prompts.test.ts` and `packages/shared-skills/ulw-plan-unity-routing.test.ts` passed.

## WHY IT IS ENOUGH
- The two consumption paths for the updated guidance (the inlined Prometheus prompt in the OpenCode bundle and the shared-skills loader for `ulw-plan`) were both directly verified against built and loaded runtime artifacts.
- The existing dist signature pinning test passed, confirming zero regression on host prompt initialization.

## WHAT WAS OMITTED
- No live TUI interactive session was spawned because this is a prompt and skill documentation content update; loader-level and distribution-level verification provide complete evidence of production availability without secret or network overhead.
