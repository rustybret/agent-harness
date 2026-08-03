import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { expect, it } from "bun:test"
import { z } from "zod"

import { generateRelaySandbox } from "./generator"
import { GOOGLE_API_KEY_ENV } from "./model-config"

const ProviderSchema = z.object({
  npm: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  models: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const OpenCodeConfigSchema = z.object({
  model: z.string(),
  plugin: z.array(z.string()),
  provider: z.record(z.string(), ProviderSchema),
}).passthrough()

it("writes google antigravity provider config when the relay model uses google provider", async () => {
  // given
  const root = await mkdtemp(path.join(os.tmpdir(), "mailbox-cipher-relay-generator."))
  const previousGeminiPlugin = process.env["MAILBOX_E2E_GEMINI_PLUGIN"]

  try {
    // when
    const fakeGeminiPlugin = path.join(root, "fake-gemini-plugin")
    await mkdir(fakeGeminiPlugin, { recursive: true })
    process.env["MAILBOX_E2E_GEMINI_PLUGIN"] = fakeGeminiPlugin

    const sandbox = await generateRelaySandbox({
      root,
      model: "google/antigravity-gemini-3.5-flash",
      googleApiKey: "test-google-key",
    })
    const firstProject = sandbox.projects[0]
    expect(firstProject).toBeDefined()

    // then
    const configPath = path.join(firstProject?.xdg.configHome ?? "", "opencode", "opencode.json")
    const config = OpenCodeConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")))
    const registry = JSON.parse(await readFile(sandbox.registryPath, "utf8")) as { projects: Array<{ projectId: string }> }
    expect(config.model).toBe("google/antigravity-gemini-3.5-flash")
    expect(config.plugin[0]).toBe(`file://${fakeGeminiPlugin}`)
    expect(config.provider["google"]?.npm).toBe("@ai-sdk/google")
    expect(config.provider["google"]?.options?.["apiKey"]).toBe(`{env:${GOOGLE_API_KEY_ENV}}`)
    expect(config.provider["google"]?.models?.["antigravity-gemini-3.5-flash"]).toBeDefined()
    expect(firstProject?.env[GOOGLE_API_KEY_ENV]).toBe("test-google-key")
    expect(firstProject?.env["OPENCODE_CONFIG"]).toBe(configPath)
    expect(registry.projects.some((project) => project.projectId === "cipher-relay-arbiter")).toBe(true)
  } finally {
    if (previousGeminiPlugin === undefined) {
      delete process.env["MAILBOX_E2E_GEMINI_PLUGIN"]
    } else {
      process.env["MAILBOX_E2E_GEMINI_PLUGIN"] = previousGeminiPlugin
    }
    await rm(root, { recursive: true, force: true })
  }
})

it("does not load the antigravity plugin for public google models", async () => {
  // given
  const root = await mkdtemp(path.join(os.tmpdir(), "mailbox-cipher-relay-generator."))
  const previousGeminiPlugin = process.env["MAILBOX_E2E_GEMINI_PLUGIN"]

  try {
    // when
    const fakeGeminiPlugin = path.join(root, "fake-gemini-plugin")
    await mkdir(fakeGeminiPlugin, { recursive: true })
    process.env["MAILBOX_E2E_GEMINI_PLUGIN"] = fakeGeminiPlugin
    const sandbox = await generateRelaySandbox({ root, model: "google/gemini-3.5-flash", googleApiKey: "test-google-key" })
    const firstProject = sandbox.projects[0]
    expect(firstProject).toBeDefined()

    // then
    const configPath = path.join(firstProject?.xdg.configHome ?? "", "opencode", "opencode.json")
    const config = OpenCodeConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")))
    expect(config.model).toBe("google/gemini-3.5-flash")
    expect(config.plugin).not.toContain(`file://${fakeGeminiPlugin}`)
    expect(config.provider["google"]?.models?.["gemini-3.5-flash"]).toBeDefined()
    expect(firstProject?.env["OPENCODE_CONFIG"]).toBe(configPath)
  } finally {
    if (previousGeminiPlugin === undefined) {
      delete process.env["MAILBOX_E2E_GEMINI_PLUGIN"]
    } else {
      process.env["MAILBOX_E2E_GEMINI_PLUGIN"] = previousGeminiPlugin
    }
    await rm(root, { recursive: true, force: true })
  }
})

it("writes anthropic provider config and seeds auth.json when the relay model uses anthropic provider", async () => {
  // given
  const root = await mkdtemp(path.join(os.tmpdir(), "mailbox-cipher-relay-generator."))
  const hostAuthDir = path.join(root, "host-opencode")
  const hostOpencodeDir = path.join(hostAuthDir, "opencode")
  await mkdir(hostOpencodeDir, { recursive: true })
  const hostAuthPath = path.join(hostOpencodeDir, "auth.json")
  const hostAuthData = {
    anthropic: {
      type: "oauth",
      refresh: "test-refresh-token",
      access: "test-access-token",
      expires: Date.now() + 3600000,
    },
  }
  await writeFile(hostAuthPath, JSON.stringify(hostAuthData, null, 2))

  const previousXdgDataHome = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = hostAuthDir

  try {
    // when
    const sandbox = await generateRelaySandbox({
      root,
      model: "anthropic/claude-sonnet-4-6",
    })
    const firstProject = sandbox.projects[0]
    expect(firstProject).toBeDefined()

    // then
    const configPath = path.join(firstProject?.xdg.configHome ?? "", "opencode", "opencode.json")
    const config = OpenCodeConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")))
    expect(config.model).toBe("anthropic/claude-sonnet-4-6")
    expect(config.provider["anthropic"]?.npm).toBe("@ai-sdk/anthropic")
    expect(config.provider["anthropic"]?.options).toEqual({})
    expect(config.provider["anthropic"]?.models?.["claude-sonnet-4-6"]).toBeDefined()

    const sandboxAuthPath = path.join(firstProject?.xdg.dataHome ?? "", "opencode", "auth.json")
    expect(existsSync(sandboxAuthPath)).toBe(true)
    const sandboxAuth = JSON.parse(await readFile(sandboxAuthPath, "utf8"))
    expect(sandboxAuth.anthropic).toBeDefined()
    expect(sandboxAuth.anthropic.refresh).toBe("test-refresh-token")
    expect(sandboxAuth.anthropic.access).toBe("test-access-token")
  } finally {
    if (previousXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = previousXdgDataHome
    }
    await rm(root, { recursive: true, force: true })
  }
})
