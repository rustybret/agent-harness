import { mkdtempSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, test } from "bun:test"

import { projectIdForRoot } from "./project-id"

describe("projectIdForRoot", () => {
  test("#given same repoRoot called twice #when projectIdForRoot #then identical (deterministic)", () => {
    // given
    const root = mkdtempSync(path.join(tmpdir(), "proj-det-"))

    // when
    const first = projectIdForRoot(root)
    const second = projectIdForRoot(root)

    // then
    expect(first).toBe(second)
  })

  test("#given two distinct roots #when projectIdForRoot #then distinct ids (collision-safe)", () => {
    // given
    const base = mkdtempSync(path.join(tmpdir(), "proj-collide-"))
    const rootA = mkdtempSync(path.join(base, "proj-"))
    const rootB = mkdtempSync(path.join(base, "proj-"))

    // when
    const idA = projectIdForRoot(rootA)
    const idB = projectIdForRoot(rootB)

    // then
    expect(idA).not.toBe(idB)
  })

  test("#given a symlink resolving to a canonical path #when projectIdForRoot #then same id as canonical", () => {
    // given
    const base = mkdtempSync(path.join(tmpdir(), "proj-symlink-"))
    const canonical = mkdtempSync(path.join(base, "canonical-"))
    const linkPath = path.join(base, "link")
    symlinkSync(canonical, linkPath, "dir")

    // when
    const idViaLink = projectIdForRoot(linkPath)
    const idViaCanonical = projectIdForRoot(canonical)

    // then
    expect(idViaLink).toBe(idViaCanonical)
  })

  test("#given a basename with non-alphanumerics #when projectIdForRoot #then slug is lowercased and hyphen-collapsed", () => {
    // given
    const base = mkdtempSync(path.join(tmpdir(), "proj-slug-"))
    const root = mkdtempSync(path.join(base, "My_Cool Project!!-"))

    // when
    const id = projectIdForRoot(root)

    // then
    expect(id).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}$/)
    expect(id).not.toMatch(/[A-Z]/)
    expect(id).not.toMatch(/--/)
  })
})
