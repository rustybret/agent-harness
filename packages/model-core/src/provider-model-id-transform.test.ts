import { describe, expect, test } from "bun:test"

import {
	transformModelForProvider,
	transformModelForProviderDisplay,
} from "./provider-model-id-transform"

describe("provider model ID transforms", () => {
	test("transforms kimi models for kimi coding providers", () => {
		// #given a kimi coding provider
		const provider = "kimi-coding"

		// #when transforming kimi model IDs
		const transformed = transformModelForProvider(provider, "kimi-k3")
		const transformed256k = transformModelForProvider(provider, "kimi-k3-256k")

		// #then they are shortened to their coding-provider form
		expect(transformed).toBe("k3")
		expect(transformed256k).toBe("k3-256k")
	})

	test("passes through unrelated models unchanged", () => {
		// #given a kimi-for-coding provider with an unrelated model
		const provider = "kimi-for-coding"

		// #when transforming a non-kimi model
		const transformed = transformModelForProvider(provider, "gpt-5.6-luna-fast")

		// #then it passes through unchanged
		expect(transformed).toBe("gpt-5.6-luna-fast")
	})

	test("preserves hyphenated Anthropic IDs for direct API calls", () => {
		// #given Anthropic model IDs in config-display form
		const provider = "anthropic"
		const models = ["claude-haiku-4-5", "claude-opus-4-7"] as const

		for (const model of models) {
			// #when both model-core transform variants are called
			const apiResult = transformModelForProvider(provider, model)
			const displayResult = transformModelForProviderDisplay(provider, model)

			// #then direct Anthropic calls keep the strict provider model ID
			expect(apiResult).toBe(model)
			expect(displayResult).toBe(model)
		}
	})

	test("keeps dotted Claude versions for gateway providers", () => {
		// #given gateway providers that expect Claude version aliases
		const scenarios = [
			{
				provider: "github-copilot",
				model: "claude-haiku-4-5",
				expected: "claude-haiku-4.5",
			},
			{
				provider: "github-copilot",
				model: "claude-opus-4-7",
				expected: "claude-opus-4.7",
			},
			{
				provider: "vercel",
				model: "claude-haiku-4-5",
				expected: "anthropic/claude-haiku-4.5",
			},
			{
				provider: "vercel",
				model: "anthropic/claude-opus-4-7",
				expected: "anthropic/claude-opus-4.7",
			},
		] as const

		for (const scenario of scenarios) {
			// #when a gateway transform is applied
			const result = transformModelForProvider(scenario.provider, scenario.model)

			// #then the gateway receives its dotted Claude version form
			expect(result).toBe(scenario.expected)
		}
	})

	test("maps bare gemini preview aliases for gateway and google providers", () => {
		// #given bare gemini IDs that providers expose under -preview names
		const scenarios = [
			{
				provider: "google",
				model: "gemini-3.1-pro",
				expected: "gemini-3.1-pro-preview",
			},
			{
				provider: "google",
				model: "gemini-3-flash",
				expected: "gemini-3-flash-preview",
			},
			{
				provider: "github-copilot",
				model: "gemini-3.1-pro",
				expected: "gemini-3.1-pro-preview",
			},
			{
				provider: "vercel",
				model: "google/gemini-3.1-pro",
				expected: "google/gemini-3.1-pro-preview",
			},
		] as const

		for (const scenario of scenarios) {
			// #when the provider transform is applied
			const result = transformModelForProvider(scenario.provider, scenario.model)

			// #then the bare alias is rewritten to the -preview provider ID
			expect(result).toBe(scenario.expected)
		}
	})

	test("rewrites plain gemini-3-flash to gemini-3-flash-preview for google provider", () => {
		// #given plain and google-prefixed gemini-3-flash model IDs
		const scenarios = [
			{ model: "gemini-3-flash", expected: "gemini-3-flash-preview" },
			{ model: "google/gemini-3-flash", expected: "google/gemini-3-flash-preview" },
		] as const

		for (const scenario of scenarios) {
			// #when transformed for the google provider
			const result = transformModelForProvider("google", scenario.model)

			// #then it becomes the -preview form (unchanged behavior)
			expect(result).toBe(scenario.expected)
		}
	})

	test("leaves custom prefixed gemini model IDs untouched", () => {
		// #given custom config model IDs that embed a gemini name mid-string
		const scenarios = [
			{ provider: "google", model: "antigravity-gemini-3.1-pro" },
			{ provider: "google", model: "antigravity-gemini-3-flash" },
			{ provider: "google", model: "google/antigravity-gemini-3-flash" },
			{ provider: "github-copilot", model: "antigravity-gemini-3.1-pro" },
		] as const

		for (const scenario of scenarios) {
			// #when the provider transform is applied
			const result = transformModelForProvider(scenario.provider, scenario.model)

			// #then the custom model ID passes through without a -preview rewrite
			expect(result).toBe(scenario.model)
		}
	})

	test("produces identical results for non-Anthropic providers", () => {
		// #given non-Anthropic provider/model pairs
		const scenarios = [
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "google", model: "gemini-2.5-pro" },
			{ provider: "github-copilot", model: "gemini-3-flash" },
			{ provider: "vercel", model: "claude-opus-4-7" },
		] as const

		for (const scenario of scenarios) {
			// #when both transform variants are called
			const apiResult = transformModelForProvider(
				scenario.provider,
				scenario.model,
			)
			const displayResult = transformModelForProviderDisplay(
				scenario.provider,
				scenario.model,
			)

			// #then the variants match outside the direct Anthropic provider branch
			expect(displayResult).toBe(apiResult)
		}
	})
})
