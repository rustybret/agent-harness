import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { LspClient } from "./client.js";
import { type CargoMetadataLoader, resolveCargoWorkspaceRoot } from "./cargo-workspace-root.js";
import { LspManager } from "./manager.js";
import type { ResolvedServer } from "./types.js";

const rustServer: ResolvedServer = { id: "rust", command: ["rust-analyzer"], extensions: [".rs"], priority: 0 };
const realpath = (path: string): string => realpathSync.native(path);

class TestLspClient extends LspClient {
	private alive = true;

	override async start(): Promise<void> {}
	override async initialize(): Promise<void> {}
	override isAlive(): boolean {
		return this.alive;
	}
	override async stop(): Promise<void> {
		this.alive = false;
	}
}

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

function requireResolvedRoot(root: string | undefined): string {
	if (root === undefined) throw new Error("expected Cargo workspace root to resolve");
	return root;
}

describe("resolveCargoWorkspaceRoot", () => {
	let root: string;

	beforeEach(() => {
		root = realpath(mkdtempSync(join(tmpdir(), "lsp-core-cargo-root-")));
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

	it("#given two Cargo workspace members #when resolving Rust roots #then both use the canonical workspace root", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a", "crates/b"]\nresolver = "2"\n');
		const manifestA = write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const manifestB = write("crates/b/Cargo.toml", '[package]\nname = "b"\nversion = "0.1.0"\n');
		const fileA = write("crates/a/src/lib.rs", "");
		const fileB = write("crates/b/src/lib.rs", "");
		const calls: string[] = [];
		const metadataLoader: CargoMetadataLoader = async (manifestPath) => {
			calls.push(manifestPath);
			return cargoMetadata(root, [manifestA, manifestB]);
		};

		// when
		const [rootA, rootB] = await Promise.all([
			resolveCargoWorkspaceRoot(fileA, { cargoMetadataLoader: metadataLoader }),
			resolveCargoWorkspaceRoot(fileB, { cargoMetadataLoader: metadataLoader }),
		]);

		// then
		expect([rootA, rootB]).toEqual([root, root]);
		expect(calls).toEqual([manifestA, manifestB]);
	});

	it("#given cached member metadata #when acquiring LSP clients #then the manager creates one Rust lifecycle", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a", "crates/b"]\nresolver = "2"\n');
		const manifestA = write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const manifestB = write("crates/b/Cargo.toml", '[package]\nname = "b"\nversion = "0.1.0"\n');
		const fileA = write("crates/a/src/lib.rs", "");
		const fileB = write("crates/b/src/lib.rs", "");
		const createdRoots: string[] = [];
		const manager = new LspManager({
			clientFactory: (workspaceRoot, server) => {
				createdRoots.push(workspaceRoot);
				return new TestLspClient(workspaceRoot, server);
			},
		});

		try {
			// when
			const metadataLoader: CargoMetadataLoader = async () => cargoMetadata(root, [manifestA, manifestB]);
			const rootA = requireResolvedRoot(await resolveCargoWorkspaceRoot(fileA, { cargoMetadataLoader: metadataLoader }));
			const rootB = requireResolvedRoot(await resolveCargoWorkspaceRoot(fileB, { cargoMetadataLoader: metadataLoader }));
			const clientA = await manager.getClient(rootA, rustServer);
			manager.releaseClient(rootA, rustServer.id);
			const clientB = await manager.getClient(rootB, rustServer);
			manager.releaseClient(rootB, rustServer.id);

			// then
			expect(clientB).toBe(clientA);
			expect(createdRoots).toEqual([root]);
		} finally {
			await manager.stopAll();
		}
	});

	it("#given a Cargo manifest edit during metadata loading #when resolving again #then stale metadata is not cached", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a"]\nresolver = "2"\n');
		const memberManifest = write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const file = write("crates/a/src/lib.rs", "");
		const memberDir = dirname(memberManifest);
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

		// when
		const first = resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader });
		const concurrent = resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader });
		write("Cargo.toml", "[workspace]\nmembers = []\n");
		resolveFirstMetadata?.(cargoMetadata(root, [memberManifest]));

		// then
		const initialRoots = await Promise.all([first, concurrent]);
		const nextRoot = await resolveCargoWorkspaceRoot(file, { cargoMetadataLoader: metadataLoader });
		expect(initialRoots).toEqual([memberDir, memberDir]);
		expect(nextRoot).toBe(root);
		expect(calls).toEqual([memberManifest, memberManifest]);
	});

	it("#given shared Cargo metadata waiters #when every waiter aborts #then the shared operation aborts", async () => {
		// given
		write("Cargo.toml", '[workspace]\nmembers = ["crates/a"]\nresolver = "2"\n');
		write("crates/a/Cargo.toml", '[package]\nname = "a"\nversion = "0.1.0"\n');
		const file = write("crates/a/src/lib.rs", "");
		const firstController = new AbortController();
		const secondController = new AbortController();
		let operationSignal: AbortSignal | undefined;
		let loaderCalls = 0;
		const metadataLoader: CargoMetadataLoader = (_manifestPath, signal) => {
			loaderCalls += 1;
			operationSignal = signal;
			return new Promise(() => {});
		};

		// when
		const first = resolveCargoWorkspaceRoot(file, {
			cargoMetadataLoader: metadataLoader,
			signal: firstController.signal,
		}).catch((error: unknown) => (error instanceof DOMException ? error.name : "unknown"));
		const second = resolveCargoWorkspaceRoot(file, {
			cargoMetadataLoader: metadataLoader,
			signal: secondController.signal,
		}).catch((error: unknown) => (error instanceof DOMException ? error.name : "unknown"));
		firstController.abort();
		const firstOutcome = await Promise.race([first, eventLoopTurn()]);
		expect(firstOutcome).toBe("AbortError");
		secondController.abort();

		// then
		const secondOutcome = await Promise.race([second, eventLoopTurn()]);
		expect(secondOutcome).toBe("AbortError");
		expect(operationSignal?.aborted).toBe(true);
		expect(loaderCalls).toBe(1);
	});
});
