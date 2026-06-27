import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, test } from "bun:test"

import { assertPathWithinRoot, safeMessageIdFilename } from "./path-guard"

describe("assertPathWithinRoot", () => {
  test("#given candidate escaping via ../.. #when assertPathWithinRoot #then throws", () => {
    // given
    const root = mkdtempSync(path.join(tmpdir(), "guard-escape-"))
    const candidate = path.join(root, "coordination_notes", "..", "..", "etc", "passwd")

    // when / then
    expect(() => assertPathWithinRoot(root, candidate)).toThrow()
  })

  test("#given candidate symlink pointing outside root #when assertPathWithinRoot #then throws", () => {
    // given
    const base = mkdtempSync(path.join(tmpdir(), "guard-symlink-"))
    const root = path.join(base, "root")
    mkdirSync(root)
    const outside = path.join(base, "outside")
    mkdirSync(outside)
    const linkInsideRoot = path.join(root, "evil-link")
    symlinkSync(outside, linkInsideRoot, "dir")

    // when / then
    expect(() => assertPathWithinRoot(root, path.join(linkInsideRoot, "secret.md"))).toThrow()
  })

  test("#given candidate inside root that does not exist yet #when assertPathWithinRoot #then does not throw", () => {
    // given
    const root = mkdtempSync(path.join(tmpdir(), "guard-ok-"))
    const candidate = path.join(root, "coordination_notes", "new-message.md")

    // when / then
    expect(() => assertPathWithinRoot(root, candidate)).not.toThrow()
  })

  test("#given candidate equal to root #when assertPathWithinRoot #then does not throw", () => {
    // given
    const root = mkdtempSync(path.join(tmpdir(), "guard-root-"))

    // when / then
    expect(() => assertPathWithinRoot(root, root)).not.toThrow()
  })
})

describe("safeMessageIdFilename", () => {
  test("#given messageId with a slash #when safeMessageIdFilename #then throws", () => {
    expect(() => safeMessageIdFilename("../etc/passwd")).toThrow()
  })

  test("#given messageId with a backslash #when safeMessageIdFilename #then throws", () => {
    expect(() => safeMessageIdFilename("a\\b")).toThrow()
  })

  test("#given messageId with a null byte #when safeMessageIdFilename #then throws", () => {
    expect(() => safeMessageIdFilename("abc\u0000def")).toThrow()
  })

  test("#given messageId with a control char #when safeMessageIdFilename #then throws", () => {
    expect(() => safeMessageIdFilename("abc\u0001def")).toThrow()
  })

  test("#given a valid uuid #when safeMessageIdFilename #then returns <uuid>.md", () => {
    // given
    const uuid = "11111111-1111-4111-8111-111111111111"

    // when
    const filename = safeMessageIdFilename(uuid)

    // then
    expect(filename).toBe(`${uuid}.md`)
  })
})
