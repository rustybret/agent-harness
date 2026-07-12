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

  const stubbedRuntimeProbe = `
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.argv[1];

Bun.plugin({
  name: "opentui-runtime-module-stubs",
  setup(build) {
    build.module("opentui:runtime-module:%40opentui%2Fsolid", () => ({
      loader: "js",
      contents: \`
        export function createComponent(Comp, props) { return Comp(props); }
        export function insert(parent, accessor) { 
          parent.children.push(accessor);
        }
        export function effect(fn) { 
          let prev = {};
          globalThis.__mockEffects.push(() => { prev = fn(prev) || prev; });
          globalThis.__mockEffects[globalThis.__mockEffects.length - 1]();
        }
        export function memo(fn) { return fn; }
        export function createElement(tag) { return { tag, children: [], props: {} }; }
        export function setProp(node, name, value) { 
          node.props[name] = value; 
          return value;
        }
        export function insertNode(parent, node) { parent.children.push(node); }
        export function createTextNode(text) { return { text }; }
      \`
    }));
    build.module("opentui:runtime-module:solid-js", () => ({
      loader: "js",
      contents: \`
        export function createSignal(initial) {
          let value = initial;
          const read = () => value;
          const write = (newVal) => {
            value = newVal;
            for (const fn of globalThis.__mockEffects) fn();
          };
          return [read, write];
        }
        export function createMemo(fn) {
          let value;
          globalThis.__mockEffects.push(() => { value = fn(); });
          globalThis.__mockEffects[globalThis.__mockEffects.length - 1]();
          return () => value;
        }
        export function createEffect(fn) {
          globalThis.__mockEffects.push(fn);
          fn();
        }
      \`
    }));
  }
});

globalThis.__mockEffects = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const compiled = await import(pathToFileURL(join(packageRoot, "dist/tui-compiled/mailbox-sidebar.js")).href);
assert(
  typeof compiled.createMailboxSidebarController === "function",
  "compiled TUI export shape is invalid",
);

const controller = compiled.createMailboxSidebarController({
  getMailbox: () => ({
    inboundUnread: 0,
    inboundProcessed: 0,
    outboundUnresolved: 0,
    outboundRead: 0,
    outboundFailed: 0,
    projects: []
  }),
  getPrefs: () => ({ rememberCollapsed: false, header: { label: "Mailbox", showVersion: false } }),
  badgeTextColor: () => undefined,
  initialCollapsed: true,
});

const element = compiled.MailboxSidebar({ controller, theme: {} });

function stringify(node) {
  if (typeof node === "function") return stringify(node());
  if (Array.isArray(node)) return node.map(stringify).join("");
  if (node && node.text !== undefined) return node.text;
  if (node && node.children) return node.children.map(stringify).join("");
  return String(node);
}

const initialOutput = stringify(element);
assert(initialOutput.includes("▶"), "initial output missing collapse marker");

controller.toggle();

const expandedOutput = stringify(element);
assert(expandedOutput.includes("▼"), "expanded output missing collapse marker");
assert(initialOutput !== expandedOutput, "reactivity proof failed: output did not change after signal write");

console.log("stubbed runtime probe loaded the compiled TUI path and proved reactivity");
`;
  const probeResult = spawnSync("bun", ["-e", stubbedRuntimeProbe, installedPackageRoot], { cwd: installRoot, encoding: "utf8" });
  if (probeResult.status !== 0) {
    console.error(probeResult.stdout);
    console.error(probeResult.stderr);
    fail("stubbed virtual runtime probe", "exited with non-zero status");
  }
  console.log(probeResult.stdout.trim());
  check("stubbed virtual runtime probe imports the compiled TUI entry and proves reactivity", true);

  const rawFallbackProbe = `
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.argv[1];
const tui = await import(pathToFileURL(join(packageRoot, "dist/tui.js")).href);
if (typeof tui.default?.tui !== "function") {
  throw new Error("raw fallback default export shape is invalid");
}
console.log("raw fallback probe loaded the TUI entry");
`;
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
