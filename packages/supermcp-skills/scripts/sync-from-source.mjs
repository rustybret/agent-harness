#!/usr/bin/env node
// Sync the six vendored unitySuperMCP domain skills from their source repo.
// Node, zero dependencies. Idempotent: a second consecutive run reports zero
// changes and leaves MANIFEST.json byte-identical (synced_at is preserved when
// nothing changed). Fails cleanly (non-zero exit, no partial writes) on a bad
// --source.
//
// Usage:
//   node packages/supermcp-skills/scripts/sync-from-source.mjs [--source <dir>]

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");
const SKILLS_DEST = join(PACKAGE_ROOT, "skills");
const MANIFEST_PATH = join(PACKAGE_ROOT, "MANIFEST.json");

const DEFAULT_SOURCE =
  "/Volumes/Topper2TB/Git/unitySuperMCP/supermcp-skills/Samples~/AgentSkills";
const SOURCE_REPO = "https://github.com/rustybret/unitySuperMCP.git";

// The ONLY skills this package vendors. Adding to this list is a deliberate act;
// unitySuperMCP's other skills (unity-gamedev, unity-visual-qa, ...) are NOT
// vendored to avoid name collisions and scope creep.
const VENDORED_SKILLS = [
  "unity-scene",
  "unity-script-roslyn",
  "unity-asset",
  "unity-build",
  "unity-runtime",
  "unity-bridge-bootstrap",
];

function parseArgs(argv) {
  let source = DEFAULT_SOURCE;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") {
      source = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--source=")) {
      source = arg.slice("--source=".length);
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: node sync-from-source.mjs [--source <dir>]\n",
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (!source) {
    fail("--source requires a directory path");
  }
  return { source: resolve(source) };
}

function fail(message) {
  process.stderr.write(`sync-from-source: error: ${message}\n`);
  process.exit(1);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Validate the source BEFORE touching the destination so a bad --source leaves
// no partial writes.
function validateSource(source) {
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    fail(`source is not a directory: ${source}`);
  }
  const missing = [];
  for (const name of VENDORED_SKILLS) {
    const skillFile = join(source, name, "SKILL.md");
    if (!existsSync(skillFile) || !statSync(skillFile).isFile()) {
      missing.push(`${name}/SKILL.md`);
    }
  }
  if (missing.length > 0) {
    fail(
      `source is missing expected skill files:\n  ${missing.join("\n  ")}\n` +
        `(looked under ${source})`,
    );
  }
}

function resolveSourceRev(source) {
  try {
    return execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function readExistingManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const { source } = parseArgs(process.argv.slice(2));
  validateSource(source);

  const previous = readExistingManifest();
  const previousBySha = new Map();
  if (previous && Array.isArray(previous.files)) {
    for (const f of previous.files) previousBySha.set(f.path, f.sha256);
  }

  // Snapshot destination BEFORE mutation for accurate diff reporting.
  const beforeShas = new Map();
  if (existsSync(SKILLS_DEST)) {
    for (const abs of listFilesRecursive(SKILLS_DEST)) {
      const rel = relative(PACKAGE_ROOT, abs).split("\\").join("/");
      beforeShas.set(rel, sha256(readFileSync(abs)));
    }
  }

  // Copy: wipe each vendored skill dir, then copy byte-identical from source.
  for (const name of VENDORED_SKILLS) {
    const srcDir = join(source, name);
    const destDir = join(SKILLS_DEST, name);
    rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });
    cpSync(srcDir, destDir, { recursive: true });
  }

  // Compute manifest files[] over the freshly copied skills.
  const files = [];
  for (const abs of listFilesRecursive(SKILLS_DEST).sort()) {
    const rel = relative(PACKAGE_ROOT, abs).split("\\").join("/");
    files.push({ path: rel, sha256: sha256(readFileSync(abs)) });
  }

  // Diff summary against the pre-copy destination snapshot.
  const afterShas = new Map(files.map((f) => [f.path, f.sha256]));
  const added = [];
  const modified = [];
  const removed = [];
  for (const [path, hash] of afterShas) {
    if (!beforeShas.has(path)) added.push(path);
    else if (beforeShas.get(path) !== hash) modified.push(path);
  }
  for (const path of beforeShas.keys()) {
    if (!afterShas.has(path)) removed.push(path);
  }
  const changed = added.length + modified.length + removed.length;

  // Idempotent MANIFEST: only bump synced_at when the file set or source_rev
  // actually changed, so a no-op run keeps MANIFEST.json byte-identical.
  const sourceRev = resolveSourceRev(source);
  const filesUnchanged =
    previous &&
    previous.source_rev === sourceRev &&
    Array.isArray(previous.files) &&
    previous.files.length === files.length &&
    files.every((f) => previousBySha.get(f.path) === f.sha256);

  const syncedAt =
    filesUnchanged && previous.synced_at
      ? previous.synced_at
      : new Date().toISOString();

  const manifest = {
    source_repo: SOURCE_REPO,
    source_rev: sourceRev,
    synced_at: syncedAt,
    files,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(`Synced ${files.length} file(s) from ${source}\n`);
  process.stdout.write(`source_rev: ${sourceRev}\n`);
  if (changed === 0) {
    process.stdout.write("No changes (0 drift).\n");
  } else {
    process.stdout.write(`Changes: ${changed}\n`);
    for (const p of added) process.stdout.write(`  A ${p}\n`);
    for (const p of modified) process.stdout.write(`  M ${p}\n`);
    for (const p of removed) process.stdout.write(`  D ${p}\n`);
  }
}

main();
