import { mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, spyOn, test } from "bun:test"

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
        const firstResult = await registry.registerProject(root1)
        const secondResult = await registry.registerProject(root2)

        // then
        const projects = await registry.listProjects()
        expect(projects).toHaveLength(2)
        const ids = projects.map((entry) => entry.projectId).sort()
        const expected = [
          projectIdForRoot(realpathSync(root1)),
          projectIdForRoot(realpathSync(root2)),
        ].sort()
        expect(ids).toEqual(expected)
        expect(firstResult).toEqual({ created: true })
        expect(secondResult).toEqual({ created: true })
        expect(projects.every((entry) => entry.registeredAt === entry.lastSeen)).toBe(true)
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
        const firstResult = await registry.registerProject(root)
        const firstEntry = (await registry.listProjects())[0]
        await new Promise((resolve) => setTimeout(resolve, 5))
        const secondResult = await registry.registerProject(root)

        // then
        const projects = await registry.listProjects()
        expect(projects).toHaveLength(1)
        expect(firstResult).toEqual({ created: true })
        expect(secondResult).toEqual({ created: false })
        expect(projects[0]?.registeredAt).toBe(firstEntry?.registeredAt)
        expect(projects[0]?.lastSeen ?? 0).toBeGreaterThan(firstEntry?.lastSeen ?? 0)
      })
    })
  })

  describe("#given a legacy entry without registeredAt", () => {
    describe("#when the same root is registered again", () => {
      test("#then it is not treated as created and registeredAt is not backfilled", async () => {
        // given
        const registryPath = makeRegistryPath()
        const root = makeRepoRoot("legacy")
        const canonicalRoot = realpathSync(root)
        writeFileSync(
          registryPath,
          JSON.stringify({
            projects: [
              {
                projectId: projectIdForRoot(canonicalRoot),
                repoRoot: canonicalRoot,
                displayName: path.basename(canonicalRoot),
                lastSeen: 1,
              },
            ],
          }),
        )
        const registry = new ProjectRegistry(registryPath)

        // when
        const result = await registry.registerProject(root)

        // then
        const entry = (await registry.listProjects())[0]
        expect(result).toEqual({ created: false })
        expect(entry).not.toHaveProperty("registeredAt")
        expect(entry?.lastSeen ?? 0).toBeGreaterThan(1)
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

  describe("#given five concurrent registerProject calls for the same root", () => {
    describe("#when all resolve", () => {
      test("#then exactly one reports created and the registry JSON remains valid", async () => {
        // given
        const registryPath = makeRegistryPath()
        const registry = new ProjectRegistry(registryPath)
        const root = makeRepoRoot("conc-same")

        // when
        const results = await Promise.all(
          Array.from({ length: 5 }, () => registry.registerProject(root)),
        )

        // then
        const raw = await readFile(registryPath, "utf8")
        const parsed: unknown = JSON.parse(raw)
        expect(parsed).toHaveProperty("projects")
        const projects = await registry.listProjects()
        expect(projects).toHaveLength(1)
        expect(results.filter((result) => result.created)).toHaveLength(1)
      })
    })
  })

  describe("#given a valid registry file and a contended live lock", () => {
    describe("#when lock acquisition times out", () => {
      test("#then registration rejects without corrupting the registry file", async () => {
        // given
        const registryPath = makeRegistryPath()
        const registry = new ProjectRegistry(registryPath)
        const existingRoot = makeRepoRoot("lock-existing")
        await registry.registerProject(existingRoot)
        writeFileSync(`${registryPath}.lock`, `project-registry\n${process.pid}\n1\n`)
        const nowSpy = spyOn(Date, "now")
          .mockReturnValueOnce(0)
          .mockReturnValueOnce(0)
          .mockReturnValue(16_000)

        try {
          // when / then
          await expect(registry.registerProject(makeRepoRoot("lock-blocked"))).rejects.toThrow(
            "Timed out acquiring lock",
          )
          const raw = await readFile(registryPath, "utf8")
          expect(() => JSON.parse(raw)).not.toThrow()
          expect(await registry.listProjects()).toHaveLength(1)
        } finally {
          nowSpy.mockRestore()
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
