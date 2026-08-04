import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { createStandaloneMcpRequestContext, runWithRequestContext } from "../request-context.js";
import { findWorkspaceRoot, resolvePathInsideContext } from "./client-wrapper.js";
import { LspInvalidPathError } from "./errors.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(root);
	return root;
}

describe("LSP client path confinement", () => {
	it("#given a relative file inside context cwd #when resolving workspace #then marker search stays inside cwd", async () => {
		const root = tempRoot("lsp-client-wrapper-root-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "file.ts"), "export const value = 1;\n");

		const workspace = await runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/file.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	it("#given an absolute file outside context cwd #when resolving #then rejects before workspace inference", async () => {
		const root = tempRoot("lsp-client-wrapper-cwd-");
		const outside = tempRoot("lsp-client-wrapper-outside-");
		mkdirSync(join(outside, ".git"), { recursive: true });
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");

		try {
			await runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
				findWorkspaceRoot(join(outside, "file.ts")),
			);
			throw new Error("expected outside path to be rejected");
		} catch (error) {
			expect(error).toBeInstanceOf(LspInvalidPathError);
		}
	});

	it("#given a symlink inside cwd that points outside #when resolving #then rejects the escape", () => {
		const root = tempRoot("lsp-client-wrapper-symlink-root-");
		const outside = tempRoot("lsp-client-wrapper-symlink-outside-");
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");
		symlinkSync(outside, join(root, "linked"));

		expect(() =>
			runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
				resolvePathInsideContext("linked/file.ts"),
			),
		).toThrow(LspInvalidPathError);
	});

	it("#given a repo-relative path and a cwd inside that repo #when resolving #then shared segments are not duplicated", () => {
		// given: a monorepo where the caller names files from the repo root while the LSP process runs
		// inside the package - naive resolution yields <pkg>/packages/pkg/src/file.ts, which is absent
		const repoRoot = tempRoot("lsp-client-wrapper-monorepo-");
		const packageRoot = join(repoRoot, "packages", "pkg");
		mkdirSync(join(packageRoot, "src"), { recursive: true });
		writeFileSync(join(packageRoot, "src", "file.ts"), "export const value = 1;\n");

		// when
		const resolved = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: packageRoot }), () =>
			resolvePathInsideContext("packages/pkg/src/file.ts"),
		);

		// then
		expect(resolved).toBe(join(realpathSync(packageRoot), "src", "file.ts"));
	});

	it("#given a path relative to the cwd itself #when resolving #then it still resolves directly", () => {
		// given
		const repoRoot = tempRoot("lsp-client-wrapper-direct-");
		const packageRoot = join(repoRoot, "packages", "pkg");
		mkdirSync(join(packageRoot, "src"), { recursive: true });
		writeFileSync(join(packageRoot, "src", "file.ts"), "export const value = 1;\n");

		// when
		const resolved = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: packageRoot }), () =>
			resolvePathInsideContext("src/file.ts"),
		);

		// then
		expect(resolved).toBe(join(realpathSync(packageRoot), "src", "file.ts"));
	});

	it("#given a missing file whose prefix overlaps the cwd #when resolving #then it reports the path as written", () => {
		// given: overlap recovery must not invent a path for a file that simply does not exist
		const repoRoot = tempRoot("lsp-client-wrapper-missing-");
		const packageRoot = join(repoRoot, "packages", "pkg");
		mkdirSync(packageRoot, { recursive: true });

		// when
		const resolved = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: packageRoot }), () =>
			resolvePathInsideContext("packages/pkg/src/nope.ts"),
		);

		// then
		expect(resolved).toBe(join(realpathSync(packageRoot), "packages", "pkg", "src", "nope.ts"));
	});
});
