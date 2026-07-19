import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const gitmodulesPath = process.env.GITMODULES_OVERRIDE ?? join(repoRoot, ".gitmodules");

type SubmoduleEntry = { name: string; path: string; url: string };

function parseGitmodules(content: string): SubmoduleEntry[] {
	const entries: SubmoduleEntry[] = [];
	let current: Partial<SubmoduleEntry> | undefined;
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		const header = line.match(/^\[submodule "(?<name>[^"]+)"\]$/);
		if (header?.groups) {
			if (current?.path !== undefined && current.url !== undefined) {
				entries.push({ name: current.name ?? "", path: current.path, url: current.url });
			}
			current = { name: header.groups.name };
			continue;
		}
		if (!current) continue;
		const pathMatch = line.match(/^path\s*=\s*(?<value>.+)$/);
		if (pathMatch?.groups) {
			current.path = pathMatch.groups.value.trim();
			continue;
		}
		const urlMatch = line.match(/^url\s*=\s*(?<value>.+)$/);
		if (urlMatch?.groups) current.url = urlMatch.groups.value.trim();
	}
	if (current?.path !== undefined && current.url !== undefined) {
		entries.push({ name: current.name ?? "", path: current.path, url: current.url });
	}
	return entries;
}

const gitmodulesPresent = existsSync(gitmodulesPath);

const describeIfGitmodules = gitmodulesPresent ? describe : describe.skip;
const describeIfNoGitmodules = gitmodulesPresent ? describe.skip : describe;

describeIfGitmodules("frontend upstream provenance submodules", () => {
	const content = gitmodulesPresent ? readFileSync(gitmodulesPath, "utf8") : "";
	const submodules = parseGitmodules(content);

	const expectedUpstreams = [
		"packages/shared-skills/upstreams/open-design",
		"packages/shared-skills/upstreams/taste-skill",
		"packages/shared-skills/upstreams/ui-ux-pro-max",
		"packages/shared-skills/upstreams/designpowers",
	];

	test("declares all 4 frontend content upstreams", () => {
		// given the committed .gitmodules
		const paths = submodules.map((entry) => entry.path);
		// then the 4 frontend content upstreams are declared
		for (const expected of expectedUpstreams) {
			expect(paths).toContain(expected);
		}
	});

	test("every submodule path is under packages/shared-skills/upstreams/", () => {
		// then every submodule path lives under the non-shipped upstreams dir
		for (const entry of submodules) {
			expect(entry.path.startsWith("packages/shared-skills/upstreams/")).toBe(true);
		}
	});

	test("no submodule path references a skills/ directory", () => {
		// then no submodule sits under a shipped skills directory
		for (const entry of submodules) {
			expect(entry.path.includes("shared-skills/skills/")).toBe(false);
			expect(/(^|\/)skills\//.test(entry.path)).toBe(false);
		}
	});
});

describeIfNoGitmodules("frontend upstream provenance submodules (fork: dropped)", () => {
	test("declares no submodules at all", () => {
		// given this fork deliberately purges the provenance submodules
		// then there is no committed .gitmodules to declare any submodule
		expect(existsSync(gitmodulesPath)).toBe(false);
	});
});
