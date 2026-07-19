import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type CargoMetadataLoader, resolveCargoWorkspaceRoot } from "./cargo-workspace-root.js";

interface WorkspaceDeclarationCase {
	readonly name: string;
	readonly manifest: string;
}

const workspaceDeclarations: readonly WorkspaceDeclarationCase[] = [
	{ name: "inline", manifest: 'workspace = { members = [], resolver = "2" }\n' },
	{ name: "dotted", manifest: 'workspace.members = []\nworkspace.resolver = "2"\n' },
];

const realpath = (path: string): string => realpathSync.native(path);

function cargoMetadata(workspaceRoot: string, manifestPaths: readonly string[]): string {
	return JSON.stringify({
		workspace_root: workspaceRoot,
		workspace_members: manifestPaths.map((_, index) => `member-${index}`),
		packages: manifestPaths.map((manifestPath, index) => ({ id: `member-${index}`, manifest_path: manifestPath })),
	});
}

describe("Cargo workspace declaration cache isolation", () => {
	let root: string;

	beforeEach(() => {
		root = realpath(mkdtempSync(join(tmpdir(), "cargo-declaration-isolation-")));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function write(relativePath: string, content = ""): string {
		const absolute = join(root, relativePath);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, content);
		return absolute;
	}

	for (const declaration of workspaceDeclarations) {
		it(`#given outer metadata names a nested ${declaration.name} workspace #when resolving nested #then outer cache does not publish it`, async () => {
			// given
			const outerManifest = write("Cargo.toml", '[workspace]\nmembers = ["tools/nested"]\nresolver = "2"\n');
			const outerFile = write("src/lib.rs");
			const nestedManifest = write("tools/nested/Cargo.toml", declaration.manifest);
			const nestedFile = write("tools/nested/src/lib.rs");
			const nestedRoot = dirname(nestedManifest);
			const calls: string[] = [];
			const metadataLoader: CargoMetadataLoader = (manifestPath) => {
				calls.push(manifestPath);
				return Promise.resolve(calls.length === 1 ? cargoMetadata(root, [nestedManifest]) : cargoMetadata(nestedRoot, [nestedManifest]));
			};

			// when
			const resolvedOuter = await resolveCargoWorkspaceRoot(outerFile, { cargoMetadataLoader: metadataLoader });
			const resolvedNested = await resolveCargoWorkspaceRoot(nestedFile, { cargoMetadataLoader: metadataLoader });

			// then
			expect({ resolvedOuter, resolvedNested, loaderCalls: calls.length }).toEqual({
				resolvedOuter: root,
				resolvedNested: nestedRoot,
				loaderCalls: 2,
			});
			expect(calls).toEqual([outerManifest, nestedManifest]);
		});

		it(`#given nested ordinary member changes to ${declaration.name} workspace mid-flight #when resolving nested #then stale outer cache is not committed`, async () => {
			// given
			const outerManifest = write("Cargo.toml", '[workspace]\nmembers = ["tools/nested"]\nresolver = "2"\n');
			const outerFile = write("src/lib.rs");
			const nestedManifest = write("tools/nested/Cargo.toml", '[package]\nname = "nested"\nversion = "0.1.0"\n');
			const nestedFile = write("tools/nested/src/lib.rs");
			const nestedRoot = dirname(nestedManifest);
			let resolveOuterMetadata: ((value: string) => void) | undefined;
			const calls: string[] = [];
			const metadataLoader: CargoMetadataLoader = (manifestPath) => {
				calls.push(manifestPath);
				if (calls.length === 1) {
					return new Promise((resolveMetadata) => {
						resolveOuterMetadata = resolveMetadata;
					});
				}
				return Promise.resolve(cargoMetadata(nestedRoot, [nestedManifest]));
			};
			const outerResolution = resolveCargoWorkspaceRoot(outerFile, { cargoMetadataLoader: metadataLoader });

			// when
			write("tools/nested/Cargo.toml", declaration.manifest);
			resolveOuterMetadata?.(cargoMetadata(root, [nestedManifest]));
			const resolvedOuter = await outerResolution;
			const resolvedNested = await resolveCargoWorkspaceRoot(nestedFile, { cargoMetadataLoader: metadataLoader });

			// then
			expect({ resolvedOuter, resolvedNested, loaderCalls: calls.length }).toEqual({
				resolvedOuter: root,
				resolvedNested: nestedRoot,
				loaderCalls: 2,
			});
			expect(calls).toEqual([outerManifest, nestedManifest]);
		});
	}

	it("#given malformed nested manifest content from outer metadata #when resolving nested #then it is not published", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["tools/nested"]\nresolver = "2"\n');
		const outerFile = write("src/lib.rs");
		const nestedManifest = write("tools/nested/Cargo.toml", '[package\nname = "nested"\n');
		const nestedFile = write("tools/nested/src/lib.rs");
		const nestedRoot = dirname(nestedManifest);
		const calls: string[] = [];
		const metadataLoader: CargoMetadataLoader = (manifestPath) => {
			calls.push(manifestPath);
			return Promise.resolve(calls.length === 1 ? cargoMetadata(root, [nestedManifest]) : cargoMetadata(nestedRoot, [nestedManifest]));
		};

		// when
		await resolveCargoWorkspaceRoot(outerFile, { cargoMetadataLoader: metadataLoader });
		const resolvedNested = await resolveCargoWorkspaceRoot(nestedFile, { cargoMetadataLoader: metadataLoader });

		// then
		expect({ resolvedNested, loaderCalls: calls.length }).toEqual({ resolvedNested: nestedRoot, loaderCalls: 2 });
	});

	it("#given ordinary nested package metadata #when resolving outer then nested #then one outer load pre-fills nested", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["tools/nested"]\nresolver = "2"\n');
		const outerFile = write("src/lib.rs");
		const nestedManifest = write("tools/nested/Cargo.toml", '[package]\nname = "nested"\nversion = "0.1.0"\n');
		const nestedFile = write("tools/nested/src/lib.rs");
		let callCount = 0;
		const metadataLoader: CargoMetadataLoader = () => {
			callCount += 1;
			return Promise.resolve(cargoMetadata(root, [nestedManifest]));
		};

		// when
		const resolvedOuter = await resolveCargoWorkspaceRoot(outerFile, { cargoMetadataLoader: metadataLoader });
		const resolvedNested = await resolveCargoWorkspaceRoot(nestedFile, { cargoMetadataLoader: metadataLoader });

		// then
		expect([resolvedOuter, resolvedNested]).toEqual([root, root]);
		expect(callCount).toBe(1);
	});
});
