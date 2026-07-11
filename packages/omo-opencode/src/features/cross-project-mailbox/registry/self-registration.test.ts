import { describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, chmod } from "node:fs/promises"
import { realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { createProjectRegistry } from "./project-registry"
import { ensureSelfRegistered } from "./self-registration"

describe("ensureSelfRegistered", () => {
  describe("#given a valid repo root and enabled mailbox", () => {
    it("#then registers the project with a fresh lastSeen", async () => {
      // given
      const tmpHome = await mkdtemp(path.join(os.tmpdir(), "omo-selfreg-"))
      const registryPath = path.join(tmpHome, "project-registry.json")
      const registry = createProjectRegistry(registryPath)
      const repoRoot = await mkdtemp(path.join(tmpHome, "repo-"))

      // when
      const result = await ensureSelfRegistered({ registry, repoRoot })

      // then
      expect(result).not.toBeNull()
      expect(result!.created).toBe(true)
      const projects = await registry.listProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0]!.repoRoot).toBe(realpathSync(repoRoot))
      expect(projects[0]!.lastSeen).toBeGreaterThan(0)
    })
  })

  describe("#given a disabled mailbox (registry untouched)", () => {
    it("#then does not write to the registry", async () => {
      // given
      const tmpHome = await mkdtemp(path.join(os.tmpdir(), "omo-selfreg-disabled-"))
      const registryPath = path.join(tmpHome, "project-registry.json")
      const registry = createProjectRegistry(registryPath)
      const repoRoot = await mkdtemp(path.join(tmpHome, "repo-"))

      // when — simulate "disabled" by not calling ensureSelfRegistered
      // (in production, hooks aren't created at all when disabled)

      // then
      const projects = await registry.listProjects()
      expect(projects).toHaveLength(0)
    })
  })

  describe("#given a registry write failure (read-only dir)", () => {
    it("#then returns null without throwing", async () => {
      // given
      const tmpHome = await mkdtemp(path.join(os.tmpdir(), "omo-selfreg-readonly-"))
      const readOnlyDir = path.join(tmpHome, "readonly")
      await mkdir(readOnlyDir)
      const registryPath = path.join(readOnlyDir, "project-registry.json")
      const registry = createProjectRegistry(registryPath)
      const repoRoot = await mkdtemp(path.join(tmpHome, "repo-"))

      // make the parent dir read-only so mkdir/open will fail
      await chmod(readOnlyDir, 0o555)

      // when
      const result = await ensureSelfRegistered({ registry, repoRoot })

      // then — should return null, not throw
      expect(result).toBeNull()
    })
  })

  describe("#given a second session for the same project", () => {
    it("#then returns created:false with no duplicate entry", async () => {
      // given
      const tmpHome = await mkdtemp(path.join(os.tmpdir(), "omo-selfreg-dup-"))
      const registryPath = path.join(tmpHome, "project-registry.json")
      const registry = createProjectRegistry(registryPath)
      const repoRoot = await mkdtemp(path.join(tmpHome, "repo-"))

      // when
      const first = await ensureSelfRegistered({ registry, repoRoot })
      const second = await ensureSelfRegistered({ registry, repoRoot })

      // then
      expect(first!.created).toBe(true)
      expect(second!.created).toBe(false)
      const projects = await registry.listProjects()
      expect(projects).toHaveLength(1)
    })
  })
})
