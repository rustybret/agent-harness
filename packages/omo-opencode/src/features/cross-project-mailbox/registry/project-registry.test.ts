import { mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, test } from "bun:test"

import { projectIdForRoot } from "../envelope/project-id"
import { ProjectRegistry } from "./project-registry"
import { ProjectNotFoundError } from "./types"

function makeRegistryPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "registry-"))
  return path.join(dir, "project-registry.json")
}

function makeRepoRoot(label: string): string {
  return mkdtempSync(path.join(tmpdir(), `repo-${label}-`))
}

describe("ProjectRegistry", () => {
  describe("#given an empty registry and two distinct repo roots", () => {
    describe("#when registerProject is called for each", () => {
      test("#then both entries are present with projectIdForRoot keys", async () => {
        // given
        const registry = new ProjectRegistry(makeRegistryPath())
        const root1 = makeRepoRoot("one")
        const root2 = makeRepoRoot("two")

        // when
        await registry.registerProject(root1)
        await registry.registerProject(root2)

        // then
        const projects = await registry.listProjects()
        expect(projects).toHaveLength(2)
        const ids = projects.map((entry) => entry.projectId).sort()
        const expected = [
          projectIdForRoot(realpathSync(root1)),
          projectIdForRoot(realpathSync(root2)),
        ].sort()
        expect(ids).toEqual(expected)
      })
    })
  })

  describe("#given the same repo root registered twice", () => {
    describe("#when registerProject is called twice", () => {
      test("#then only one entry exists and lastSeen is updated", async () => {
        // given
        const registry = new ProjectRegistry(makeRegistryPath())
        const root = makeRepoRoot("idem")

        // when
        await registry.registerProject(root)
        const firstSeen = (await registry.listProjects())[0]?.lastSeen ?? 0
        await new Promise((resolve) => setTimeout(resolve, 5))
        await registry.registerProject(root)

        // then
        const projects = await registry.listProjects()
        expect(projects).toHaveLength(1)
        expect(projects[0]?.lastSeen ?? 0).toBeGreaterThanOrEqual(firstSeen)
      })
    })
  })

  describe("#given a registry with two entries", () => {
    describe("#when resolveTargetRepoRoot is called with a known projectId", () => {
      test("#then the canonical repoRoot is returned", async () => {
        // given
        const registry = new ProjectRegistry(makeRegistryPath())
        const root1 = makeRepoRoot("res-one")
        const root2 = makeRepoRoot("res-two")
        await registry.registerProject(root1)
        await registry.registerProject(root2)

        // when
        const projectId = projectIdForRoot(realpathSync(root1))
        const resolved = await registry.resolveTargetRepoRoot(projectId)

        // then
        expect(resolved).toBe(realpathSync(root1))
      })
    })
  })

  describe("#given an unknown projectId", () => {
    describe("#when resolveTargetRepoRoot is called", () => {
      test("#then it throws a typed ProjectNotFoundError", async () => {
        // given
        const registry = new ProjectRegistry(makeRegistryPath())

        // when / then
        await expect(registry.resolveTargetRepoRoot("unknown-id-abc123")).rejects.toBeInstanceOf(
          ProjectNotFoundError,
        )
      })
    })
  })

  describe("#given five concurrent registerProject calls to the same file", () => {
    describe("#when all resolve", () => {
      test("#then the registry JSON is valid and all entries are present", async () => {
        // given
        const registryPath = makeRegistryPath()
        const registry = new ProjectRegistry(registryPath)
        const roots = Array.from({ length: 5 }, (_unused, index) => makeRepoRoot(`conc-${index}`))

        // when
        await Promise.all(roots.map((root) => registry.registerProject(root)))

        // then
        const raw = await readFile(registryPath, "utf8")
        const parsed: unknown = JSON.parse(raw)
        expect(parsed).toHaveProperty("projects")
        const projects = await registry.listProjects()
        expect(projects).toHaveLength(5)
        const ids = new Set(projects.map((entry) => entry.projectId))
        for (const root of roots) {
          expect(ids.has(projectIdForRoot(realpathSync(root)))).toBe(true)
        }
      })
    })
  })

  describe("#given entries with different lastSeen timestamps", () => {
    describe("#when listProjects is called", () => {
      test("#then entries are sorted newest lastSeen first", async () => {
        // given
        const registry = new ProjectRegistry(makeRegistryPath())
        const rootA = makeRepoRoot("sort-a")
        const rootB = makeRepoRoot("sort-b")
        await registry.registerProject(rootA)
        await new Promise((resolve) => setTimeout(resolve, 5))
        await registry.registerProject(rootB)

        // when
        const projects = await registry.listProjects()

        // then
        expect(projects[0]?.repoRoot).toBe(realpathSync(rootB))
        expect(projects[1]?.repoRoot).toBe(realpathSync(rootA))
      })
    })

    describe("#when two entries share the same lastSeen", () => {
      test("#then they are ordered alphabetically by displayName", async () => {
        // given
        const registryPath = makeRegistryPath()
        const registry = new ProjectRegistry(registryPath)
        const sameLastSeen = 1000
        const data = {
          projects: [
            { projectId: "id-zeta", repoRoot: "/tmp/zeta", displayName: "zeta", lastSeen: sameLastSeen },
            { projectId: "id-alpha", repoRoot: "/tmp/alpha", displayName: "alpha", lastSeen: sameLastSeen },
          ],
        }
        writeFileSync(registryPath, JSON.stringify(data))

        // when
        const projects = await registry.listProjects()

        // then
        expect(projects.map((entry) => entry.displayName)).toEqual(["alpha", "zeta"])
      })
    })
  })

  describe("#given an OpenClaw reply-session-registry.jsonl with projectPath entries", () => {
    describe("#when discoverFromOpenClaw is called", () => {
      test("#then those paths are added as hint entries", async () => {
        // given
        const registry = new ProjectRegistry(makeRegistryPath())
        const hintRoot = makeRepoRoot("hint")
        const openclawPath = path.join(mkdtempSync(path.join(tmpdir(), "oc-")), "reply-session-registry.jsonl")
        const lines = [
          JSON.stringify({ projectPath: hintRoot, sessionId: "s1", tmuxPaneId: "%1" }),
          "not-json-skip-me",
          JSON.stringify({ sessionId: "s2" }),
          JSON.stringify({ projectPath: "/nonexistent/path/zzz", sessionId: "s3" }),
        ].join("\n")
        writeFileSync(openclawPath, lines)

        // when
        await registry.discoverFromOpenClaw(openclawPath)

        // then
        const projects = await registry.listProjects()
        const ids = new Set(projects.map((entry) => entry.projectId))
        expect(ids.has(projectIdForRoot(realpathSync(hintRoot)))).toBe(true)
      })

      test("#then existing entries are not replaced", async () => {
        // given
        const registry = new ProjectRegistry(makeRegistryPath())
        const existingRoot = makeRepoRoot("existing")
        await registry.registerProject(existingRoot)
        const openclawPath = path.join(mkdtempSync(path.join(tmpdir(), "oc-")), "reply-session-registry.jsonl")
        writeFileSync(openclawPath, JSON.stringify({ projectPath: makeRepoRoot("oc-hint"), sessionId: "s1" }))

        // when
        await registry.discoverFromOpenClaw(openclawPath)

        // then
        const projects = await registry.listProjects()
        const ids = new Set(projects.map((entry) => entry.projectId))
        expect(ids.has(projectIdForRoot(realpathSync(existingRoot)))).toBe(true)
        expect(projects).toHaveLength(2)
      })

      test("#then a missing openclaw registry file is tolerated silently", async () => {
        // given
        const registry = new ProjectRegistry(makeRegistryPath())

        // when / then
        await registry.discoverFromOpenClaw("/nonexistent/openclaw/reply-session-registry.jsonl")
        const projects = await registry.listProjects()
        expect(projects).toHaveLength(0)
      })
    })
  })
})
