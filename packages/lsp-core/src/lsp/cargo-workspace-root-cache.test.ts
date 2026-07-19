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
	{ name: "inline", manifest: 'workspace = { members = ["a"], resolver = "2" }\n' },
	{ name: "dotted", manifest: 'workspace.members = ["a"]\nworkspace.resolver = "2"\n' },
];

const realpath = (path: string): string => realpathSync.native(path);

function cargoMetadata(workspaceRoot: string, manifestPaths: readonly string[]): string {
	return JSON.stringify({
		workspace_root: workspaceRoot,
		workspace_members: manifestPaths.map((_, index) => `member-${index}`),
		packages: manifestPaths.map((manifestPath, index) => ({ id: `member-${index}`, manifest_path: manifestPath })),
	});
}

function eventLoopTurn(): Promise<"event-loop"> {
	return new Promise((resolveTurn) => setImmediate(() => resolveTurn("event-loop")));
}

describe("resolveCargoWorkspaceRoot cache", () => {
	let root: string;

	beforeEach(() => {
		root = realpath(mkdtempSync(join(tmpdir(), "cargo-ws-cache-")));
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

	it("#given ancestor edit during metadata #when resolving again #then stale in-flight metadata is rejected", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a"]\nresolver = "2"\n');
		const memberManifest = write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const file = write("crates/a/src/lib.rs", "");
		const memberDir = join(root, "crates/a");
		let resolveFirstMetadata: ((value: string) => void) | undefined;
		const calls: string[] = [];
		const metadataLoader: CargoMetadataLoader = (manifestPath) => {
			calls.push(manifestPath);
			if (calls.length === 1) {
				return new Promise((resolveMetadata) => {
					resolveFirstMetadata = resolveMetadata;
				});
			}
			return Promise.resolve(cargoMetadata(memberDir, [memberManifest]));
		};

		// when
		const first = resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader });
		const concurrent = resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader });
		write("Cargo.toml", "[workspace]\nmembers = []\n");
		resolveFirstMetadata?.(cargoMetadata(root, [memberManifest]));

		// then
		expect(await Promise.all([first, concurrent])).toEqual([memberDir, memberDir]);
		expect(await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader })).toBe(memberDir);
		expect(calls).toEqual([memberManifest, memberManifest]);
	});

	it("#given in-flight metadata #when ancestor manifest changes before next request #then a fresh request starts", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a"]\nresolver = "2"\n');
		const memberManifest = write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const file = write("crates/a/src/lib.rs", "");
		const memberDir = join(root, "crates/a");
		let resolveFirstMetadata: ((value: string) => void) | undefined;
		const calls: string[] = [];
		const metadataLoader: CargoMetadataLoader = (manifestPath) => {
			calls.push(manifestPath);
			if (calls.length === 1) {
				return new Promise((resolveMetadata) => {
					resolveFirstMetadata = resolveMetadata;
				});
			}
			return Promise.resolve(cargoMetadata(root, [memberManifest]));
		};
		const first = resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader });

		// when
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a", "crates/b"]\nresolver = "2"\n');
		const second = resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader });
		const secondBeforeFirst = await Promise.race([second, eventLoopTurn()]);
		resolveFirstMetadata?.(cargoMetadata(root, [memberManifest]));
		const [firstRoot, secondRoot] = await Promise.all([first, second]);

		// then
		expect([secondBeforeFirst, secondRoot]).toEqual([root, root]);
		expect(calls).toEqual([memberManifest, memberManifest]);
		expect(firstRoot).toBe(memberDir);
	});

	it("#given metadata points at a missing workspace root #when resolving twice #then it falls back and backs off", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a"]\nresolver = "2"\n');
		const memberManifest = write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const file = write("crates/a/src/lib.rs", "");
		const memberDir = join(root, "crates/a");
		const calls: string[] = [];
		const metadataLoader: CargoMetadataLoader = (manifestPath) => {
			calls.push(manifestPath);
			return Promise.resolve(cargoMetadata(join(root, "missing"), [memberManifest]));
		};
		const now = () => 10_000;

		// when
		const first = await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader, now });
		const second = await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader, now });

		// then
		expect([first, second]).toEqual([memberDir, memberDir]);
		expect(calls).toEqual([memberManifest]);
	});

	it("#given slow cargo failure #when it completes after the first backoff window #then backoff starts at completion", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a"]\nresolver = "2"\n');
		write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const file = write("crates/a/src/lib.rs", "");
		const memberDir = join(root, "crates/a");
		let nowMs = 30_000;
		const calls: string[] = [];
		const metadataLoader: CargoMetadataLoader = (manifestPath) => {
			calls.push(manifestPath);
			nowMs += 1_001;
			return Promise.reject(new Error("slow cargo failure"));
		};
		const now = () => nowMs;

		// when
		const first = await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader, now });
		const immediate = await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader, now });

		// then
		expect([first, immediate]).toEqual([memberDir, memberDir]);
		expect(calls).toEqual([join(root, "crates/a/Cargo.toml")]);
	});

	it("#given metadata omits the requested member #when resolving #then it falls back", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a", "crates/b"]\nresolver = "2"\n');
		write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const otherManifest = write("crates/b/Cargo.toml", '[package]\nname = "b"\nversion = "0.1.0"\n');
		const file = write("crates/a/src/lib.rs", "");
		const memberDir = join(root, "crates/a");
		const metadataLoader: CargoMetadataLoader = () => Promise.resolve(cargoMetadata(root, [otherManifest]));

		// when
		const resolved = await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader });

		// then
		expect(resolved).toBe(memberDir);
	});

	it("#given metadata names manifests outside the canonical root #when resolving two workspaces #then cache stays isolated", async () => {
		// given
		const workspaceAManifest = write("workspace-a/Cargo.toml", "[workspace]\nmembers = []\n");
		const workspaceAFile = write("workspace-a/src/lib.rs", "");
		const workspaceBManifest = write("workspace-b/Cargo.toml", "[workspace]\nmembers = []\n");
		const workspaceBFile = write("workspace-b/src/lib.rs", "");
		const workspaceA = dirname(workspaceAManifest);
		const workspaceB = dirname(workspaceBManifest);
		let callCount = 0;
		const metadataLoader: CargoMetadataLoader = () => {
			callCount += 1;
			return Promise.resolve(callCount === 1 ? cargoMetadata(workspaceA, [workspaceAManifest, workspaceBManifest]) : cargoMetadata(workspaceB, [workspaceBManifest]));
		};

		// when
		const resolvedA = await resolveCargoWorkspaceRoot(workspaceAFile, { cargoMetadataLoader: metadataLoader });
		const resolvedB = await resolveCargoWorkspaceRoot(workspaceBFile, { cargoMetadataLoader: metadataLoader });

		// then
		expect([resolvedA, resolvedB]).toEqual([workspaceA, workspaceB]);
		expect(callCount).toBe(2);
	});

	it("#given nested independent workspace in outer metadata #when resolving nested file #then outer cache does not publish it", async () => {
		// given
		const outerManifest = write("Cargo.toml", '["workspace"]\nmembers = ["crates/group/a"]\n');
		const outerFile = write("src/lib.rs", "");
		const memberManifest = write("crates/group/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\ndescription = """\n[workspace]\n"""\n');
		const memberFile = write("crates/group/a/src/lib.rs", "");
		const nestedManifest = write("tools/nested/Cargo.toml", "[workspace]\nmembers = []\n");
		const nestedFile = write("tools/nested/src/lib.rs", "");
		const nestedRoot = dirname(nestedManifest);
		const calls: string[] = [];
		const metadataLoader: CargoMetadataLoader = (manifestPath) => {
			calls.push(manifestPath);
			return Promise.resolve(calls.length === 1 ? cargoMetadata(root, [outerManifest, memberManifest, nestedManifest]) : cargoMetadata(nestedRoot, [nestedManifest]));
		};

		// when
		const resolvedOuter = await resolveCargoWorkspaceRoot(outerFile, { cargoMetadataLoader: metadataLoader });
		const resolvedMember = await resolveCargoWorkspaceRoot(memberFile, { cargoMetadataLoader: metadataLoader });
		const resolvedNested = await resolveCargoWorkspaceRoot(nestedFile, { cargoMetadataLoader: metadataLoader });

		// then
		expect([resolvedOuter, resolvedMember, resolvedNested]).toEqual([root, root, nestedRoot]);
		expect(calls).toEqual([outerManifest, nestedManifest]);
	});

	for (const declaration of workspaceDeclarations) {
		it(`#given cached member gains absent intermediate ${declaration.name} manifest #when resolving #then metadata reruns`, async () => {
			// given
			const outerManifest = write("Cargo.toml", '[workspace]\nmembers = ["crates/group/a"]\nresolver = "2"\n');
			const outerFile = write("src/lib.rs", "");
			const memberManifest = write("crates/group/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
			const memberFile = write("crates/group/a/src/lib.rs", "");
			const nestedManifest = join(root, "crates/group/Cargo.toml");
			const nestedRoot = dirname(nestedManifest);
			const calls: string[] = [];
			const metadataLoader: CargoMetadataLoader = (manifestPath) => {
				calls.push(manifestPath);
				return Promise.resolve(calls.length === 1 ? cargoMetadata(root, [memberManifest]) : cargoMetadata(nestedRoot, [memberManifest]));
			};

			// when
			expect(await resolveCargoWorkspaceRoot(outerFile, { cargoMetadataLoader: metadataLoader })).toBe(root);
			write("crates/group/Cargo.toml", declaration.manifest);
			const resolvedMember = await resolveCargoWorkspaceRoot(memberFile, { cargoMetadataLoader: metadataLoader });

			// then
			expect(resolvedMember).toBe(nestedRoot);
			expect(calls).toEqual([outerManifest, memberManifest]);
		});

		it(`#given absent intermediate ${declaration.name} manifest appears mid-flight #when resolving #then stale outer metadata is not cached`, async () => {
			// given
			const outerManifest = write("Cargo.toml", '[workspace]\nmembers = ["crates/group/a"]\nresolver = "2"\n');
			const outerFile = write("src/lib.rs", "");
			const memberManifest = write("crates/group/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
			const nestedFile = write("crates/group/src/lib.rs", "");
			const nestedManifest = write("crates/group/Cargo.toml", "");
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
				return Promise.resolve(cargoMetadata(nestedRoot, [memberManifest]));
			};
			const outerResolution = resolveCargoWorkspaceRoot(outerFile, { cargoMetadataLoader: metadataLoader });

			// when
			write("crates/group/Cargo.toml", declaration.manifest);
			resolveOuterMetadata?.(cargoMetadata(root, [memberManifest]));
			const resolvedOuter = await outerResolution;
			const resolvedNested = await resolveCargoWorkspaceRoot(nestedFile, { cargoMetadataLoader: metadataLoader });

			// then
			expect({ resolvedOuter, resolvedNested }).toEqual({ resolvedOuter: root, resolvedNested: nestedRoot });
			expect(calls).toEqual([outerManifest, nestedManifest]);
		});

		it(`#given cached member turns intermediate ordinary manifest into ${declaration.name} workspace #when resolving #then metadata reruns`, async () => {
			// given
			const outerManifest = write("Cargo.toml", '[workspace]\nmembers = ["crates/group/a"]\nresolver = "2"\n');
			const outerFile = write("src/lib.rs", "");
			const intermediateManifest = write("crates/group/Cargo.toml", '[package]\nname = "group"\nversion = "0.1.0"\n');
			const memberManifest = write("crates/group/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
			const memberFile = write("crates/group/a/src/lib.rs", "");
			const nestedRoot = dirname(intermediateManifest);
			const calls: string[] = [];
			const metadataLoader: CargoMetadataLoader = (manifestPath) => {
				calls.push(manifestPath);
				return Promise.resolve(calls.length === 1 ? cargoMetadata(root, [memberManifest]) : cargoMetadata(nestedRoot, [memberManifest]));
			};

			// when
			expect(await resolveCargoWorkspaceRoot(outerFile, { cargoMetadataLoader: metadataLoader })).toBe(root);
			write("crates/group/Cargo.toml", declaration.manifest);
			const resolvedMember = await resolveCargoWorkspaceRoot(memberFile, { cargoMetadataLoader: metadataLoader });

			// then
			expect(resolvedMember).toBe(nestedRoot);
			expect(calls).toEqual([outerManifest, memberManifest]);
		});
	}

	it("#given recent metadata failure #when ancestor manifest changes #then failure backoff is bypassed", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a"]\nresolver = "2"\n');
		const memberManifest = write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const file = write("crates/a/src/lib.rs", "");
		const memberDir = join(root, "crates/a");
		let callCount = 0;
		const metadataLoader: CargoMetadataLoader = () => {
			callCount += 1;
			return callCount === 1 ? Promise.reject(new Error("temporary cargo failure")) : Promise.resolve(cargoMetadata(root, [memberManifest]));
		};
		const now = () => 20_000;
		expect(await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader, now })).toBe(memberDir);

		// when
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a", "crates/b"]\nresolver = "2"\n');
		const resolved = await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader, now });

		// then
		expect(resolved).toBe(root);
		expect(callCount).toBe(2);
	});
});
