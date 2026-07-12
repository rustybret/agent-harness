#!/usr/bin/env bun
// Adapted from AFT packages/opencode-plugin/scripts/build-tui.ts, MIT licensed.

import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const sourceRoot = process.env.OMO_TUI_SOLID_SOURCE_ROOT ?? join(repositoryRoot, "packages/omo-opencode/src/tui-solid")
const outputRoot = process.env.OMO_TUI_SOLID_OUTPUT_ROOT ?? join(repositoryRoot, "dist/tui-compiled")
const runtimeSpecifiers = new Set([
  "@opentui/core",
  "@opentui/solid",
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "@opentui/solid/jsx-dev-runtime",
  "solid-js",
  "solid-js/store",
])

type TransformSolidSource = (
  code: string,
  options: {
    readonly filename: string
    readonly moduleName: string
    readonly resolvePath: (specifier: string) => string | null
  },
) => Promise<string>

function runtimeModuleId(specifier: string): string {
  return `opentui:runtime-module:${encodeURIComponent(specifier)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isTransformSolidSource(value: unknown): value is TransformSolidSource {
  return typeof value === "function"
}

function transformSolidSourceFrom(loadedModule: unknown, from: string): TransformSolidSource {
  if (!isRecord(loadedModule) || !isTransformSolidSource(loadedModule.transformSolidSource)) {
    throw new Error(`@opentui/solid transform loaded from ${from} without transformSolidSource`)
  }

  return loadedModule.transformSolidSource
}

async function resolveSolidTransformPath(): Promise<string> {
  const packageJsonSpecifier = "@opentui/solid/package.json"
  const errors: string[] = []

  try {
    const packageJsonUrl = import.meta.resolve(packageJsonSpecifier)
    return join(dirname(fileURLToPath(packageJsonUrl)), "scripts/solid-transform.js")
  } catch (error) {
    errors.push(`import.meta.resolve: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const require = createRequire(import.meta.url)
    return join(dirname(require.resolve(packageJsonSpecifier)), "scripts/solid-transform.js")
  } catch (error) {
    errors.push(`require.resolve: ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(`Unable to resolve @opentui/solid transform (${errors.join("; ")})`)
}

async function loadTransformSolidSource(): Promise<{ readonly transformSolidSource: TransformSolidSource; readonly from: string }> {
  const transformPath = await resolveSolidTransformPath()
  return {
    transformSolidSource: transformSolidSourceFrom(await import(pathToFileURL(transformPath).href), transformPath),
    from: transformPath,
  }
}

function isShippedSourceFile(filePath: string): boolean {
  if (/\.test\.[cm]?tsx?$/.test(basename(filePath))) return false
  return filePath.endsWith(".tsx") || filePath.endsWith(".ts")
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  const files: string[] = []
  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(entryPath)))
      continue
    }

    if (entry.isFile() && isShippedSourceFile(entryPath)) {
      files.push(entryPath)
    }
  }

  return files
}

async function copyPlainTypeScript(sourceFile: string, outputFile: string): Promise<void> {
  await mkdir(dirname(outputFile), { recursive: true })
  await copyFile(sourceFile, outputFile)
}

async function compileTsx(
  transformSolidSource: TransformSolidSource,
  sourceFile: string,
  outputFile: string,
): Promise<void> {
  const code = await readFile(sourceFile, "utf8")
  const compiled = await transformSolidSource(code, {
    filename: sourceFile,
    moduleName: runtimeModuleId("@opentui/solid"),
    resolvePath: (specifier) => (runtimeSpecifiers.has(specifier) ? runtimeModuleId(specifier) : null),
  })

  await mkdir(dirname(outputFile), { recursive: true })
  await writeFile(outputFile, compiled)
}

const loadedTransform = await loadTransformSolidSource()
const files = await listSourceFiles(sourceRoot)

await rm(outputRoot, { recursive: true, force: true })

for (const sourceFile of files) {
  const relativePath = relative(sourceRoot, sourceFile)
  
  if (sourceFile.endsWith(".tsx")) {
    const outputFile = join(outputRoot, relativePath.replace(/\.tsx$/, ".js"))
    await compileTsx(loadedTransform.transformSolidSource, sourceFile, outputFile)
  } else {
    const outputFile = join(outputRoot, relativePath)
    await copyPlainTypeScript(sourceFile, outputFile)
  }
}

process.stdout.write(
  `build-tui-solid: transform=${loadedTransform.from}\n` +
    `build-tui-solid: wrote ${files.length} file(s) to ${relative(repositoryRoot, outputRoot)}\n`,
)
