#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const packageName = "oh-my-opencode";

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function fail(name: string, detail: string): never {
  check(name, false, detail);
  throw new Error(`${name}: ${detail}`);
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`${command} ${args.join(" ")}`, `exited with ${result.status ?? "unknown status"}`);
  }
  return result.stdout;
}

function parsePackedFilename(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  const jsonStartIndex = lines.findIndex(line => line.trim() === '[');
  if (jsonStartIndex !== -1) {
    try {
      const jsonStr = lines.slice(jsonStartIndex).join('\n');
      const packed = JSON.parse(jsonStr) as Array<{ filename?: string }>;
      const filename = packed[0]?.filename;
      if (typeof filename === "string" && filename.length > 0) return filename;
    } catch (e) {
      console.error("Failed to parse JSON from npm pack:", e);
    }
  }

  const fallback = lines
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".tgz"))
    .at(-1);
  if (fallback) return fallback;
  fail("npm pack reports a tarball", stdout.trim() || "no stdout");
}

const tempRoot = await mkdtemp(join(tmpdir(), "omo-tui-pack-"));
const installRoot = join(tempRoot, "install");

try {
  console.log("Building...");
  run("bun", ["run", "build"], repoRoot);

  console.log("Packing...");
  const packStdout = run("npm", ["pack", "--json", "--pack-destination", tempRoot], repoRoot);
  const tarball = join(tempRoot, parsePackedFilename(packStdout));
  check("npm pack produced a tarball", existsSync(tarball), tarball);

  console.log("\n--- Tarball Listing ---");
  const tarResult = spawnSync("tar", ["-tvf", tarball], { encoding: "utf8" });
  console.log(tarResult.stdout);
  console.log("-----------------------\n");

  console.log("Installing...");
  await mkdir(installRoot, { recursive: true });
  await writeFile(
    join(installRoot, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          [packageName]: `file:${tarball}`,
        },
      },
      null,
      2,
    ),
  );
  run("bun", ["install", "--production"], installRoot);

  const installedPackageRoot = join(installRoot, "node_modules", packageName);
  const compiledSidebar = join(installedPackageRoot, "dist/tui-compiled/mailbox-sidebar.js");
  check("compiled TUI sidebar ships in the packed package", existsSync(compiledSidebar));

  const compiledSidebarText = existsSync(compiledSidebar) ? await readFile(compiledSidebar, "utf8") : "";
  check(
    "compiled TUI imports the host runtime virtual modules",
    compiledSidebarText.includes("opentui:runtime-module:"),
  );

  const stubbedRuntimeProbePath = join(repoRoot, "script/qa/smoke-tui-pack-install-stubbed-probe.mjs");
  const stubbedRuntimeProbe = await readFile(stubbedRuntimeProbePath, "utf8");
  const probeResult = spawnSync("bun", ["-e", stubbedRuntimeProbe, installedPackageRoot], { cwd: installRoot, encoding: "utf8" });
  if (probeResult.status !== 0) {
    console.error(probeResult.stdout);
    console.error(probeResult.stderr);
    fail("stubbed virtual runtime probe", "exited with non-zero status");
  }
  console.log(probeResult.stdout.trim());
  check("stubbed virtual runtime probe imports the compiled TUI entry and proves reactivity", true);

  const rawFallbackProbePath = join(repoRoot, "script/qa/smoke-tui-pack-install-fallback-probe.mjs");
  const rawFallbackProbe = await readFile(rawFallbackProbePath, "utf8");
  const fallbackResult = spawnSync("bun", ["-e", rawFallbackProbe, installedPackageRoot], { cwd: installRoot, encoding: "utf8" });
  if (fallbackResult.status !== 0) {
    console.error(fallbackResult.stdout);
    console.error(fallbackResult.stderr);
    fail("bare Bun probe", "exited with non-zero status");
  }
  console.log(fallbackResult.stdout.trim());
  check("bare Bun probe imports the raw fallback", true);
} finally {
  if (process.env.KEEP_TUI_PACK_SMOKE !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`kept smoke temp dir: ${tempRoot}`);
  }
}

if (failures > 0) {
  console.error(`\nsmoke-tui-pack-install: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nsmoke-tui-pack-install: all checks passed");
