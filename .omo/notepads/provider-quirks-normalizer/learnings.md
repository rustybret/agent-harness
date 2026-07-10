# Provider Quirks Normalizer Learnings

- **Pattern Discovered**: When injecting synthetic parts into the `messages` array for the `experimental.chat.messages.transform` hook, the injected parts must be cast to `Part` (e.g., `as unknown as Part`) because the `@opencode-ai/sdk` `Part` type requires specific fields like `id`, `sessionID`, `messageID`, and `synthetic` that are not strictly necessary for the API but are required by the TypeScript definitions.
- **Gotchas**: 
  - `bun:test`'s `expect(received).toEqual(expected)` performs a strict deep equality check. When injecting parts with dynamic fields (like `time: { created: Date.now() }`) or synthetic fields, `toEqual` will fail if the expected object doesn't perfectly match. It's better to assert on specific properties (e.g., `expect(part.type).toBe("reasoning")`) or use `toHaveLength`.
  - The `tool_use` type is not explicitly in the `Part` union type in some versions of the SDK, so checking `part.type === "tool_use"` requires casting `part.type as string`.
- **Import Paths**: Used `import { createProviderQuirksNormalizerHook } from "../../hooks"` in `src/plugin/hooks/create-transform-hooks.ts` and barrel exported it from `src/hooks/index.ts`.
- **Refactoring**: Removed `as unknown as Part` type suppression anti-pattern. Instead, imported `TextPart` and `ReasoningPart` from `@opencode-ai/sdk` and typed the injected objects properly.
- **Gotchas**: `ReasoningPart` requires `time: { start: number; end?: number }` rather than `time: { created: number }`. Also, `synthetic: true` is not a valid property on `ReasoningPart`.
