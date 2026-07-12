/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))

function listRelativeFiles(root: string): string[] {
  const files: string[] = []
  const directories = [root]

  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory === undefined) continue

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        directories.push(entryPath)
        continue
      }

      if (entry.isFile()) {
        files.push(relative(root, entryPath))
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

describe("build-tui-solid precompile", () => {
  test("transforms TSX and TS sources, emits JS, and excludes test files", async () => {
    // #given
    const workspace = mkdtempSync(join(tmpdir(), "tui-solid-build-"))
    const sourceRoot = join(workspace, "src")
    const outputRoot = join(workspace, "out")
    await mkdir(join(sourceRoot, "nested"), { recursive: true })
    writeFileSync(
      join(sourceRoot, "placeholder.tsx"),
      [
        'import { createSignal } from "solid-js"',
        'import { createStore } from "solid-js/store"',
        "",
        "export function Placeholder() {",
        "  const [count] = createSignal(1)",
        "  const [state] = createStore({ label: \"ready\" })",
        "  return <box><text>{state.label}:{count()}</text></box>",
        "}",
      ].join("\n"),
    )
    writeFileSync(
      join(sourceRoot, "nested", "plain.ts"),
      [
        'import { createSignal } from "solid-js"',
        "",
        "export const copied = createSignal(true)[0]",
      ].join("\n"),
    )
    writeFileSync(join(sourceRoot, "nested", "skip.test.ts"), "throw new Error('excluded')\n")
    writeFileSync(join(sourceRoot, "skip.test.tsx"), "throw new Error('excluded')\n")

    // #when
    const result = spawnSync("bun", ["run", "script/build-tui-solid.ts"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        OMO_TUI_SOLID_SOURCE_ROOT: sourceRoot,
        OMO_TUI_SOLID_OUTPUT_ROOT: outputRoot,
      },
    })

    // #then
    expect(result.status, result.stderr).toBe(0)
    expect(listRelativeFiles(outputRoot)).toEqual(["nested/plain.js", "placeholder.js"])

    const transformedPlain = readFileSync(join(outputRoot, "nested", "plain.js"), "utf8")
    expect(transformedPlain).toContain("opentui:runtime-module:solid-js")
    expect(transformedPlain).toContain("export const copied = createSignal(true)[0]")
    expect(transformedPlain).not.toContain('from "solid-js"')

    const transformed = readFileSync(join(outputRoot, "placeholder.js"), "utf8")
    expect(transformed).toContain("opentui:runtime-module:%40opentui%2Fsolid")
    expect(transformed).toContain("opentui:runtime-module:solid-js")
    expect(transformed).toContain("opentui:runtime-module:solid-js%2Fstore")
    expect(transformed).not.toContain('from "solid-js"')
    expect(transformed).not.toContain('from "solid-js/store"')
  })
})
