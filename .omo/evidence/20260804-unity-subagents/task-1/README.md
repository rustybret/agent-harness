# Task 1 Evidence — vendor six unitySuperMCP domain skills

## What was tested

Creation and verification of the content-only vendored package
`packages/supermcp-skills/`:

1. **Sync script (happy path / idempotency)** — ran
   `node packages/supermcp-skills/scripts/sync-from-source.mjs` multiple times.
   Command driven: the real Node sync script against the real source checkout at
   `/Volumes/Topper2TB/Git/unitySuperMCP/supermcp-skills/Samples~/AgentSkills`.
   Behavior to prove: first run copies six skills + writes MANIFEST; subsequent
   runs report zero drift and leave MANIFEST.json byte-identical.
   Artifact: `happy-path-idempotent.log`.
2. **Sync script (failure path)** — ran with `--source /nonexistent-dir-xyz`.
   Behavior to prove: non-zero exit, readable error, no partial writes (MANIFEST
   unchanged). Artifact: `failure-path-bad-source.log`.
3. **Byte-identical copies** — `diff -q` each vendored `SKILL.md` against its
   source, and cross-checked every `MANIFEST.json` sha256 against
   `shasum -a 256` of the source files.
4. **Structural guards** — no `package.json` inside the vendored dir; root
   `package.json` untouched (`git diff --stat package.json` empty); frontmatter
   (`mcp: supermcp`, url `http://127.0.0.1:27182/mcp`) preserved verbatim.

## What was observed

- **First run:** `Synced 6 file(s)`, `source_rev: 21b7c5e1edada80f18868a0e4d41f02c1c31b839`, 6 files added (A), exit 0.
- **Second/third run (idempotent):** `No changes (0 drift).`, exit 0. MANIFEST
  sha256 identical before/after (`d4ceb127df8a57cb2bb7e9670d396f4921d40599f1b6c1793a83bc28411735f2`).
- **Failure run:** `sync-from-source: error: source is not a directory: /nonexistent-dir-xyz`, exit 1. MANIFEST sha256 unchanged after the failed run (no partial write).
- **Byte-identical:** all six `diff -q` reported OK; all six source `shasum`
  values equal the MANIFEST `sha256` entries exactly.
- **Guards:** `find packages/supermcp-skills -name package.json` empty;
  `git diff --stat package.json` empty; `git status` shows only the new
  untracked `packages/supermcp-skills/` dir; frontmatter intact.

## Files created

- `packages/supermcp-skills/skills/{unity-scene,unity-script-roslyn,unity-asset,unity-build,unity-runtime,unity-bridge-bootstrap}/SKILL.md`
- `packages/supermcp-skills/MANIFEST.json`
- `packages/supermcp-skills/scripts/sync-from-source.mjs`
- `packages/supermcp-skills/README.md`

## Why this is enough

The acceptance criteria are each directly demonstrated: exactly six skill dirs
exist; MANIFEST.json is valid JSON listing every copied file with a sha256 that
matches the source bytes; the sync script is idempotent (0 drift + identical
MANIFEST on re-run) and fails cleanly on a bad `--source` with no partial write;
root `package.json` is provably untouched and no workspace registration was
added. Byte-identity is proven two independent ways (`diff` and `shasum`
cross-check), so the "do not modify content / frontmatter stays as-is" guard
holds.

## What was omitted

- No live unitySuperMCP bridge was contacted (port 27182 never bound); this task
  is pure content vendoring, and skill→MCP reachability is deferred to the
  gated QA todos (9/10).
- No secrets, tokens, or env dumps are present in the captured logs (the script
  only prints file paths, a public git rev, and the public source repo URL).

## Artifacts

- `happy-path-idempotent.log` — idempotent 0-drift run (exit 0).
- `failure-path-bad-source.log` — bad `--source` run (exit 1).
- `MANIFEST.snapshot.json` — copy of the generated manifest at capture time.
