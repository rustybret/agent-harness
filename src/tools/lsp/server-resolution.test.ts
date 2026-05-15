import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findServerForPath } from "./server-resolution"

describe("findServerForPath", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omo-server-resolution-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("#given an Ansible YAML file #when resolving server #then selects ansible-ls", () => {
    writeFileSync(join(tmpDir, "ansible.cfg"), "[defaults]\n")
    const filePath = join(tmpDir, "playbook.yml")
    writeFileSync(filePath, "---\n")

    const result = findServerForPath(filePath)

    expect(result.status).not.toBe("not_configured")
    if (result.status === "found" || result.status === "not_installed") {
      expect(result.server.id).toBe("ansible-ls")
    }
  })

  it("#given a common non-Ansible YAML file #when resolving server #then selects yaml-ls", () => {
    writeFileSync(join(tmpDir, "ansible.cfg"), "[defaults]\n")
    const filePath = join(tmpDir, "docker-compose.yml")
    writeFileSync(filePath, "services: {}\n")

    const result = findServerForPath(filePath)

    expect(result.status).not.toBe("not_configured")
    if (result.status === "found" || result.status === "not_installed") {
      expect(result.server.id).toBe("yaml-ls")
    }
  })

  it("#given a CMakeLists.txt file #when resolving server #then selects cmake", () => {
    const filePath = join(tmpDir, "CMakeLists.txt")
    writeFileSync(filePath, "cmake_minimum_required(VERSION 3.0)\n")

    const result = findServerForPath(filePath)

    expect(result.status).not.toBe("not_configured")
    if (result.status === "found" || result.status === "not_installed") {
      expect(result.server.id).toBe("cmake")
    }
  })

  it("#given a GDScript file #when resolving server #then selects gdscript", () => {
    const filePath = join(tmpDir, "player.gd")
    writeFileSync(filePath, "extends Node2D\n")

    const result = findServerForPath(filePath)

    expect(result.status).not.toBe("not_configured")
    if (result.status === "found" || result.status === "not_installed") {
      expect(result.server.id).toBe("gdscript")
    }
  })

  it("#given an XML file #when resolving server #then selects lemminx", () => {
    const filePath = join(tmpDir, "AndroidManifest.xml")
    writeFileSync(filePath, "<?xml version=\"1.0\"?>\n")

    const result = findServerForPath(filePath)

    expect(result.status).not.toBe("not_configured")
    if (result.status === "found" || result.status === "not_installed") {
      expect(result.server.id).toBe("lemminx")
    }
  })
})
