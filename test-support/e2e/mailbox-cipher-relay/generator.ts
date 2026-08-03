import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"

import { projectIdForRoot } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/envelope/project-id"
import { createProjectRegistry } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/registry/project-registry"
import type { RegistryData } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/registry/types"
import type { MailboxMode } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema"
import { defaultSentenceNumbers, expectedSentence, writeCipherFixture } from "./cipher-fixture"
import { GOOGLE_API_KEY_ENV, modelConfigFor, resolveGoogleApiKey } from "./model-config"
import { relayPluginPaths } from "./plugin-paths"
import {
  ARBITER_PROJECT_ID,
  DEFAULT_RELAY_MODEL,
  DEFAULT_PROJECT_COUNT,
  type RelayHop,
  type RelayProject,
  type RelaySandbox,
  type RelayXdgPaths,
} from "./types"

export interface GenerateRelaySandboxOptions {
  readonly root?: string
  readonly repoRoot?: string
  readonly projectCount?: number
  readonly hopModes?: readonly MailboxMode[]
  readonly model?: string
  readonly googleApiKey?: string
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || address === null) {
        server.close()
        reject(new Error("failed to allocate a TCP port"))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

async function ensureRoot(root: string | undefined): Promise<string> {
  if (root !== undefined) {
    await mkdir(root, { recursive: true, mode: 0o700 })
    return root
  }
  return await mkdtemp(path.join(os.tmpdir(), "mailbox-cipher-relay."))
}

function xdgPaths(root: string, name: string): RelayXdgPaths {
  const base = path.join(root, "xdg", name)
  return {
    dataHome: path.join(base, "data"),
    configHome: path.join(base, "config"),
    cacheHome: path.join(base, "cache"),
    stateHome: path.join(base, "state"),
  }
}

function opencodeConfigPath(project: RelayProject): string {
  return path.join(project.xdg.configHome, "opencode", "opencode.json")
}

async function writeOpenCodeConfig(project: RelayProject, repoRoot: string, model: string): Promise<void> {
  const opencodeDir = path.join(project.xdg.configHome, "opencode")
  await mkdir(opencodeDir, { recursive: true, mode: 0o700 })
  const modelConfig = modelConfigFor(model)
  const config = {
    $schema: "https://opencode.ai/config.json",
    plugin: relayPluginPaths(repoRoot, model),
    model: modelConfig.fullModel,
    provider: {
      [modelConfig.providerId]: modelConfig.provider,
    },
  }
  await writeFile(opencodeConfigPath(project), `${JSON.stringify(config, null, 2)}\n`)

  const hostAccountsPath = path.join(os.homedir(), ".config", "opencode", "antigravity-accounts.json")
  if (existsSync(hostAccountsPath)) {
    await copyFile(hostAccountsPath, path.join(opencodeDir, "antigravity-accounts.json"))
  }
}

async function registerArbiterSender(registryPath: string, root: string): Promise<void> {
  const now = Date.now()
  const arbiterRoot = path.join(root, "arbiter")
  await mkdir(arbiterRoot, { recursive: true, mode: 0o700 })
  const data = JSON.parse(await readFile(registryPath, "utf8")) as RegistryData
  const withoutArbiter = data.projects.filter((project) => project.projectId !== ARBITER_PROJECT_ID)
  withoutArbiter.push({
    projectId: ARBITER_PROJECT_ID,
    repoRoot: arbiterRoot,
    displayName: ARBITER_PROJECT_ID,
    lastSeen: now,
    registeredAt: now,
  })
  await writeFile(registryPath, `${JSON.stringify({ projects: withoutArbiter }, null, 2)}\n`)
}

async function writeMailboxConfig(project: RelayProject, allowedProjectIds: readonly string[]): Promise<void> {
  const configDir = path.join(project.root, ".opencode")
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  const senders: Record<string, unknown> = {}
  for (const projectId of allowedProjectIds) {
    senders[projectId] = {
      access: "allow",
      intent_budget: "impl",
      allowed_modes: ["todo-append", "subagent"],
    }
  }
  const config = {
    cross_project_mailbox: {
      enabled: true,
      default_sender_access: "allow-none",
      senders,
      bounds: {
        max_hops: 6,
        max_notes_per_drain: 10,
        same_pair_rate_limit_per_min: 30,
        body_digest_ttl_min: 60,
        max_body_bytes: 32768,
        reservation_ttl_ms: 120000,
      },
    },
  }
  await writeFile(path.join(configDir, "oh-my-openagent.jsonc"), `${JSON.stringify(config, null, 2)}\n`)
}

function hopModesFor(projectCount: number, requested: readonly MailboxMode[] | undefined): readonly MailboxMode[] {
  const defaults: readonly MailboxMode[] = ["todo-append", "subagent"]
  const modes = requested !== undefined && requested.length > 0 ? requested : defaults
  return Array.from({ length: projectCount - 1 }, (_unused, index) => modes[index % modes.length] ?? "todo-append")
}

export async function generateRelaySandbox(options: GenerateRelaySandboxOptions = {}): Promise<RelaySandbox> {
  const root = await ensureRoot(options.root)
  const home = path.join(root, "home")
  const registryPath = path.join(home, ".omo", "project-registry.json")
  const arbiterDropDir = path.join(root, "arbiter", "drop")
  const reportPath = path.join(root, "arbiter", "report.json")
  const contextPath = path.join(root, "relay-context.json")
  const repoRoot = options.repoRoot ?? process.cwd()
  const projectCount = options.projectCount ?? DEFAULT_PROJECT_COUNT
  const model = options.model ?? process.env["MAILBOX_E2E_MODEL"] ?? DEFAULT_RELAY_MODEL
  const modelConfig = modelConfigFor(model)
  const googleApiKey = modelConfig.providerId === "google" ? resolveGoogleApiKey(options.googleApiKey) : undefined

  await mkdir(home, { recursive: true, mode: 0o700 })
  await mkdir(arbiterDropDir, { recursive: true, mode: 0o700 })

  const projects: RelayProject[] = []
  for (let index = 0; index < projectCount; index += 1) {
    const name = `project-${String.fromCharCode(97 + index)}`
    const projectRoot = path.join(root, "projects", name)
    const xdg = xdgPaths(root, name)
    await mkdir(projectRoot, { recursive: true, mode: 0o700 })
    await mkdir(xdg.dataHome, { recursive: true, mode: 0o700 })
    await mkdir(xdg.configHome, { recursive: true, mode: 0o700 })
    await mkdir(xdg.cacheHome, { recursive: true, mode: 0o700 })
    await mkdir(xdg.stateHome, { recursive: true, mode: 0o700 })
    const wordsPath = await writeCipherFixture(projectRoot, index)
    const port = await freePort()
    const dbPath = path.join(root, "db", `${name}.db`)
    await mkdir(path.dirname(dbPath), { recursive: true, mode: 0o700 })
    const env: Record<string, string> = {
      HOME: home,
      XDG_DATA_HOME: xdg.dataHome,
      XDG_CONFIG_HOME: xdg.configHome,
      XDG_CACHE_HOME: xdg.cacheHome,
      XDG_STATE_HOME: xdg.stateHome,
      OPENCODE_DB: dbPath,
      OPENCODE_CONFIG: path.join(xdg.configHome, "opencode", "opencode.json"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    }
    if (googleApiKey !== undefined) {
      env[GOOGLE_API_KEY_ENV] = googleApiKey
    }
    if (model.startsWith("anthropic/")) {
      const hostAuthPath = process.env.XDG_DATA_HOME
        ? path.join(process.env.XDG_DATA_HOME, "opencode", "auth.json")
        : path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
      if (existsSync(hostAuthPath)) {
        try {
          const hostAuthContent = await readFile(hostAuthPath, "utf8")
          const hostAuth = JSON.parse(hostAuthContent)
          if (hostAuth && hostAuth.anthropic) {
            const sandboxAuthDir = path.join(xdg.dataHome, "opencode")
            await mkdir(sandboxAuthDir, { recursive: true, mode: 0o700 })
            const sandboxAuth = { anthropic: hostAuth.anthropic }
            await writeFile(
              path.join(sandboxAuthDir, "auth.json"),
              JSON.stringify(sandboxAuth, null, 2) + "\n",
              { mode: 0o600 }
            )
          }
        } catch (error) {
          console.error("Failed to seed sandbox auth.json:", error)
        }
      }
    }
    projects.push({
      index,
      name,
      displayName: name,
      projectId: projectIdForRoot(projectRoot),
      root: projectRoot,
      xdg,
      dbPath,
      port,
      wordsPath,
      env,
      serveCommand: ["opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    })
  }

  const registry = createProjectRegistry(registryPath)
  for (const project of projects) {
    await registry.registerProject(project.root)
    await writeOpenCodeConfig(project, repoRoot, model)
  }
  await registerArbiterSender(registryPath, root)

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index]
    if (project === undefined) throw new Error(`missing generated project at index ${index}`)
    const next = projects[index + 1]
    const previous = projects[index - 1]
    const allowed = [next?.projectId, previous?.projectId, ARBITER_PROJECT_ID].filter((value): value is string => value !== undefined)
    await writeMailboxConfig(project, allowed)
  }

  const modes = hopModesFor(projects.length, options.hopModes)
  const hops: RelayHop[] = []
  for (let index = 0; index < projects.length - 1; index += 1) {
    const from = projects[index]
    const to = projects[index + 1]
    const requestedMode = modes[index]
    if (from === undefined || to === undefined || requestedMode === undefined) {
      throw new Error(`missing generated hop at index ${index}`)
    }
    hops.push({ fromProjectId: from.projectId, toProjectId: to.projectId, requestedMode })
  }

  const sentenceNumbers = defaultSentenceNumbers()
  const sandbox: RelaySandbox = {
    root,
    home,
    registryPath,
    arbiterDropDir,
    reportPath,
    contextPath,
    model,
    projects,
    hops,
    sentenceNumbers,
    expectedSentence: expectedSentence(sentenceNumbers),
  }
  await writeFile(contextPath, `${JSON.stringify(sandbox, null, 2)}\n`)
  return sandbox
}
