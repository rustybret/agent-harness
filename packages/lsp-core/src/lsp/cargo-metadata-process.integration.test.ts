import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { defaultCargoMetadataLoader } from "./cargo-metadata-process.js";

const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const FIXTURE_READY_TIMEOUT_MS = 3_000;
const NODE_EXECUTABLE = process.env["NODE"] ?? "node";
const CARGO_METADATA_PROCESS_SIGNALS: readonly NodeJS.Signals[] =
	process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"];

type ProcessTreePids = {
	readonly wrapper: number;
	readonly descendant: number;
};

type ProcessSignalListener = (...args: never[]) => unknown;

class FakeCargoReadinessTimeoutError extends Error {
	override readonly name = "FakeCargoReadinessTimeoutError";
}

let fixtureDirectory = "";
let binaryDirectory = "";
let preloadPath = "";
let wrapperPidFile = "";
let descendantPidFile = "";
const activePids = new Set<number>();

function readPid(path: string): number | undefined {
	if (!existsSync(path)) return undefined;
	const pid = Number(readFileSync(path, "utf8"));
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function readProcessTreePids(): ProcessTreePids | undefined {
	const wrapper = readPid(wrapperPidFile);
	const descendant = readPid(descendantPidFile);
	return wrapper === undefined || descendant === undefined ? undefined : { wrapper, descendant };
}

async function waitForCondition(predicate: () => boolean, timeoutMs: number, intervalMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new FakeCargoReadinessTimeoutError("condition timed out");
		await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
	}
}

async function waitForProcessTree(): Promise<ProcessTreePids> {
	await waitForCondition(() => readProcessTreePids() !== undefined, FIXTURE_READY_TIMEOUT_MS, 10);
	const pids = readProcessTreePids();
	if (pids === undefined) {
		throw new FakeCargoReadinessTimeoutError("fake Cargo process tree did not become ready");
	}
	activePids.add(pids.wrapper);
	activePids.add(pids.descendant);
	return pids;
}

function isMissingProcessError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (isMissingProcessError(error)) return false;
		throw error;
	}
}

function killPidBestEffort(pid: number): void {
	try {
		process.kill(pid, "SIGKILL");
	} catch (error) {
		if (!isMissingProcessError(error)) throw error;
	}
}

async function expectProcessTreeGone(pids: ProcessTreePids): Promise<void> {
	await waitForCondition(() => !isPidAlive(pids.wrapper) && !isPidAlive(pids.descendant), PROCESS_EXIT_TIMEOUT_MS, 25);
	expect({ wrapper: isPidAlive(pids.wrapper), descendant: isPidAlive(pids.descendant) }).toEqual({
		wrapper: false,
		descendant: false,
	});
}

function findAddedListener(signal: NodeJS.Signals, before: readonly ProcessSignalListener[]): ProcessSignalListener | undefined {
	return process.listeners(signal).find((listener) => !before.includes(listener));
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
		throw new Error("expected promise to reject");
	} catch (error) {
		return error;
	}
}

function startCargoMetadata(signal?: AbortSignal): Promise<string> {
	const previousPath = process.env["PATH"];
	const previousNodeOptions = process.env["NODE_OPTIONS"];
	process.env["PATH"] = previousPath === undefined ? binaryDirectory : `${binaryDirectory}${delimiter}${previousPath}`;
	process.env["NODE_OPTIONS"] = [previousNodeOptions, `--require=${JSON.stringify(preloadPath)}`]
		.filter((value) => value !== undefined && value.length > 0)
		.join(" ");
	try {
		return defaultCargoMetadataLoader(join(fixtureDirectory, "Cargo.toml"), signal);
	} finally {
		if (previousPath === undefined) delete process.env["PATH"];
		else process.env["PATH"] = previousPath;
		if (previousNodeOptions === undefined) delete process.env["NODE_OPTIONS"];
		else process.env["NODE_OPTIONS"] = previousNodeOptions;
	}
}

beforeEach(() => {
	fixtureDirectory = mkdtempSync(join(tmpdir(), "cargo-metadata-process-tree-"));
	binaryDirectory = join(fixtureDirectory, "bin");
	mkdirSync(binaryDirectory);
	wrapperPidFile = join(fixtureDirectory, "wrapper.pid");
	descendantPidFile = join(fixtureDirectory, "descendant.pid");
	preloadPath = join(fixtureDirectory, "fake-cargo-preload.cjs");
	const descendantWorkerPath = join(fixtureDirectory, "fake-cargo-descendant.cjs");
	const descendantLauncherPath = join(fixtureDirectory, "fake-cargo-launcher.cjs");
	writeFileSync(
		descendantWorkerPath,
		[
			"for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) {",
			"  try {",
			"    process.on(signal, () => {})",
			"  } catch {}",
			"}",
			"setInterval(() => {}, 1000)",
		].join("\n"),
	);
	writeFileSync(
		descendantLauncherPath,
		[
			'const { spawn } = require("node:child_process")',
			'const { writeFileSync } = require("node:fs")',
			"const [nodeExecutable, descendantScriptPath, descendantPidFile] = process.argv.slice(2)",
			"if (nodeExecutable === undefined || descendantScriptPath === undefined || descendantPidFile === undefined) process.exit(2)",
			"const descendantEnv = { ...process.env }",
			'delete descendantEnv["NODE_OPTIONS"]',
			"const descendant = spawn(nodeExecutable, [descendantScriptPath], {",
			"  env: descendantEnv,",
			"  stdio: 'ignore',",
			"  windowsHide: true,",
			"})",
			"if (descendant.pid === undefined) process.exit(3)",
			"writeFileSync(descendantPidFile, String(descendant.pid))",
		].join("\n"),
	);
	writeFileSync(
		preloadPath,
		[
			'const { spawn } = require("node:child_process")',
			'const { writeFileSync } = require("node:fs")',
			'const { basename } = require("node:path")',
			'if (process.env["FAKE_CARGO_PRELOAD_MAIN"] !== "1" && !basename(process.argv0).toLowerCase().startsWith("cargo")) return',
			`const wrapperPidFile = ${JSON.stringify(wrapperPidFile)}`,
			`const descendantPidFile = ${JSON.stringify(descendantPidFile)}`,
			`const nodeExecutable = ${JSON.stringify(NODE_EXECUTABLE)}`,
			`const descendantWorkerPath = ${JSON.stringify(descendantWorkerPath)}`,
			`const descendantLauncherPath = ${JSON.stringify(descendantLauncherPath)}`,
			"const helper = spawn(nodeExecutable, [descendantLauncherPath, nodeExecutable, descendantWorkerPath, descendantPidFile], {",
			"  env: process.env,",
			"  stdio: 'ignore',",
			"  windowsHide: true,",
			"})",
			"helper.unref()",
			"writeFileSync(wrapperPidFile, String(process.pid))",
			"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)",
		].join("\n"),
	);
	const cargoExecutable = join(binaryDirectory, process.platform === "win32" ? "cargo.exe" : "cargo");
	if (process.platform === "win32") copyFileSync(NODE_EXECUTABLE, cargoExecutable);
	else {
		writeFileSync(
			cargoExecutable,
			[
				"#!/bin/sh",
				`printf '%s' "$$" > ${JSON.stringify(wrapperPidFile)}`,
				"(trap '' TERM HUP INT; while :; do sleep 1; done) &",
				`printf '%s' "$!" > ${JSON.stringify(descendantPidFile)}`,
				"while :; do sleep 1; done",
				"",
			].join("\n"),
		);
		chmodSync(cargoExecutable, 0o755);
	}
});

afterEach(() => {
	for (const pid of activePids) killPidBestEffort(pid);
	activePids.clear();
	rmSync(fixtureDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("defaultCargoMetadataLoader process lifecycle", () => {
	it("#given active Cargo process tree #when request aborts #then the complete process tree terminates", async () => {
		// given
		const controller = new AbortController();
		const loading = startCargoMetadata(controller.signal);
		void loading.catch(() => undefined);
		const pids = await waitForProcessTree();
		expect([isPidAlive(pids.wrapper), isPidAlive(pids.descendant)]).toEqual([true, true]);

		// when
		controller.abort();

		// then
		expect(await rejectedValue(loading)).toMatchObject({ name: "AbortError" });
		await expectProcessTreeGone(pids);
	}, 10_000);

	it("#given active Cargo process tree #when metadata times out #then the complete process tree terminates", async () => {
		// given
		const emergencyController = new AbortController();
		const loading = startCargoMetadata(emergencyController.signal);
		void loading.catch(() => undefined);
		const pids = await waitForProcessTree();
		expect([isPidAlive(pids.wrapper), isPidAlive(pids.descendant)]).toEqual([true, true]);

		try {
			// when
			const failure = loading;

			// then
			expect(await rejectedValue(failure)).toBeInstanceOf(Error);
			await expectProcessTreeGone(pids);
		} finally {
			emergencyController.abort();
		}
	}, 20_000);

	for (const signal of CARGO_METADATA_PROCESS_SIGNALS) {
		it(`#given active Cargo process tree #when ${signal} cleanup listener runs #then tree terminates and listener is removed`, async () => {
			// given
			const beforeListeners = process.listeners(signal);
			const loading = startCargoMetadata();
			void loading.catch(() => undefined);
			const pids = await waitForProcessTree();
			const listener = findAddedListener(signal, beforeListeners);
			expect(listener).toBeDefined();

			// when
			listener?.();

			// then
			expect(await rejectedValue(loading)).toMatchObject({ name: "AbortError" });
			await expectProcessTreeGone(pids);
			await waitForCondition(() => process.listeners(signal).length === beforeListeners.length, PROCESS_EXIT_TIMEOUT_MS, 25);
			expect(process.listeners(signal)).toEqual(beforeListeners);
		}, 10_000);
	}
});
