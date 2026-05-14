import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { detectAnsibleFile, getLanguageIdForPath } from "./ansible-detection"

describe("detectAnsibleFile", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omo-ansible-detection-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("#given an explicit Ansible extension #when detecting file type #then returns true", () => {
    expect(detectAnsibleFile(join(tmpDir, "playbook.ansible.yml"))).toBe(true)
    expect(detectAnsibleFile(join(tmpDir, "playbook.ansible.yaml"))).toBe(true)
  })

  it("#given a non-YAML file #when detecting file type #then returns false", () => {
    expect(detectAnsibleFile(join(tmpDir, "playbook.json"))).toBe(false)
    expect(detectAnsibleFile(join(tmpDir, "playbook.txt"))).toBe(false)
  })

  it("#given an Ansible first-line marker #when detecting file type #then returns true", () => {
    const filePath = join(tmpDir, "random.yml")
    writeFileSync(filePath, "# code: language=ansible\n---\n- hosts: all")

    expect(detectAnsibleFile(filePath)).toBe(true)
  })

  it("#given common Ansible paths #when detecting file type #then returns true", () => {
    const paths = [
      join(tmpDir, "playbooks", "site.yml"),
      join(tmpDir, "roles", "web", "tasks", "main.yml"),
      join(tmpDir, "roles", "web", "handlers", "main.yml"),
      join(tmpDir, "host_vars", "web1.yml"),
      join(tmpDir, "group_vars", "all.yml"),
      join(tmpDir, "molecule", "default", "molecule.yml"),
    ]

    for (const filePath of paths) {
      mkdirSync(join(filePath, ".."), { recursive: true })
      writeFileSync(filePath, "---\n")
      expect(detectAnsibleFile(filePath)).toBe(true)
    }
  })

  it("#given nearby Ansible project markers #when detecting file type #then returns true", () => {
    writeFileSync(join(tmpDir, "ansible.cfg"), "[defaults]\n")
    const filePath = join(tmpDir, "some-file.yml")
    writeFileSync(filePath, "---\n")

    expect(detectAnsibleFile(filePath)).toBe(true)
  })

  it("#given common non-Ansible YAML in an Ansible project #when detecting file type #then returns false", () => {
    writeFileSync(join(tmpDir, "ansible.cfg"), "[defaults]\n")
    const composePath = join(tmpDir, "docker-compose.yml")
    const workflowDir = join(tmpDir, ".github", "workflows")
    const workflowPath = join(workflowDir, "ci.yml")
    mkdirSync(workflowDir, { recursive: true })
    writeFileSync(composePath, "services: {}\n")
    writeFileSync(workflowPath, "name: ci\n")

    expect(detectAnsibleFile(composePath)).toBe(false)
    expect(detectAnsibleFile(workflowPath)).toBe(false)
  })

  it("#given Ansible and generic YAML paths #when resolving language IDs #then returns the matching language", () => {
    writeFileSync(join(tmpDir, "ansible.cfg"), "[defaults]\n")
    const ansiblePath = join(tmpDir, "some-file.yml")
    const composePath = join(tmpDir, "docker-compose.yml")
    writeFileSync(ansiblePath, "---\n")
    writeFileSync(composePath, "services: {}\n")

    expect(getLanguageIdForPath(join(tmpDir, "playbook.ansible.yml"))).toBe("ansible")
    expect(getLanguageIdForPath(ansiblePath)).toBe("ansible")
    expect(getLanguageIdForPath(composePath)).toBe("yaml")
  })
})
