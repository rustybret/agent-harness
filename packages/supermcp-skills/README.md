# supermcp-skills (vendored)

Content-only vendored copy of the six **unitySuperMCP** domain skills used by the
restricted Unity editor subagents in this repo. This is **not** a bun workspace
package: there is no `package.json`, and it is intentionally absent from the root
`package.json` `workspaces`/`files` arrays. It ships nothing but skill content, a
provenance manifest, and a manual sync script.

## What lives here

```
packages/supermcp-skills/
├── skills/
│   ├── unity-scene/SKILL.md
│   ├── unity-script-roslyn/SKILL.md
│   ├── unity-asset/SKILL.md
│   ├── unity-build/SKILL.md
│   ├── unity-runtime/SKILL.md
│   └── unity-bridge-bootstrap/SKILL.md
├── MANIFEST.json          # source_repo, source_rev, synced_at, files[] (per-file sha256)
├── scripts/
│   └── sync-from-source.mjs
└── README.md              # this file
```

The `skills/` tree is wired into OpenCode via `skills.sources` in the project
`.omo/omo.jsonc`, so `skill(name="unity-scene")` (and the other five) resolve
from here.

## Six skills only

Only these six domain skills are vendored:

`unity-scene`, `unity-script-roslyn`, `unity-asset`, `unity-build`,
`unity-runtime`, `unity-bridge-bootstrap`.

The other unitySuperMCP skills (`unity-gamedev`, `unity-visual-qa`,
`unity-multi-instance`, `unity-reflection`, `unity-playtest-automation`,
`unity-filesystem-expert`, `unity-tilemap-generation`) are deliberately **not**
copied: `unity-gamedev` would collide with this repo's own
`.opencode/skills/unity-gamedev`, and the rest are out of scope. Do not add them
without a deliberate decision.

## Manual sync workflow

The source of truth is the upstream unitySuperMCP repo. These copies are refreshed
manually — nothing here auto-updates.

```bash
# Refresh from the default source path
node packages/supermcp-skills/scripts/sync-from-source.mjs

# Or point at a different checkout
node packages/supermcp-skills/scripts/sync-from-source.mjs --source /path/to/unitySuperMCP/supermcp-skills/Samples~/AgentSkills
```

The script (Node, zero dependencies):

- copies the six skill directories byte-identical from the source (including any
  sibling reference files present under a skill dir),
- regenerates `MANIFEST.json` with the source git rev and a SHA-256 for every
  copied file,
- prints a diff summary (added / modified / removed) of what changed.

It is **idempotent**: a second consecutive run reports `No changes (0 drift).`
and leaves `MANIFEST.json` byte-identical (`synced_at` is only bumped when the
file set or source rev actually changes).

It **fails cleanly**: an invalid `--source` (missing directory, or a directory
that does not contain the six expected `SKILL.md` files) exits non-zero with a
readable error and performs **no partial writes** — the source is validated
before the destination is touched.

## License / provenance

The skill content in `skills/` is **owned by the unitySuperMCP repository**
(<https://github.com/rustybret/unitySuperMCP>) and is vendored here verbatim for
convenience. `MANIFEST.json` records the exact `source_rev` these copies were
taken from. Treat upstream as authoritative: to change skill content, change it
upstream and re-run the sync script — do not hand-edit the vendored files.
