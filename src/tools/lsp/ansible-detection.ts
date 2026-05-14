import { existsSync, readFileSync } from "fs"
import { dirname, extname, join, resolve } from "path"

import { getLanguageId } from "./language-config"

export function detectAnsibleFile(filePath: string): boolean {
  const ext = extname(filePath)
  const lowerPath = filePath.toLowerCase()

  if (hasExplicitAnsibleExtension(lowerPath)) {
    return true
  }

  if (ext !== ".yml" && ext !== ".yaml") {
    return false
  }

  if (hasAnsibleFirstLineMarker(filePath)) {
    return true
  }

  if (matchesAnsiblePathPattern(filePath)) {
    return true
  }

  if (matchesCommonNonAnsiblePath(lowerPath)) {
    return false
  }

  if (hasAnsibleProjectMarkers(filePath)) {
    return true
  }

  return false
}

function hasExplicitAnsibleExtension(lowerPath: string): boolean {
  return lowerPath.endsWith(".ansible.yml") || lowerPath.endsWith(".ansible.yaml")
}

function matchesCommonNonAnsiblePath(lowerPath: string): boolean {
  return (
    lowerPath.endsWith("docker-compose.yml") ||
    lowerPath.endsWith("docker-compose.yaml") ||
    lowerPath.includes("/.github/workflows/") ||
    lowerPath.includes("\\.github\\workflows\\")
  )
}

function hasAnsibleFirstLineMarker(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8")
    const firstLine = content.split("\n")[0]?.trim() ?? ""
    return firstLine.includes("language=ansible")
  } catch {
    return false
  }
}

function matchesAnsiblePathPattern(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase()

  if (lowerPath.includes("/playbooks/") || lowerPath.includes("\\playbooks\\")) {
    return true
  }

  const topLevelDirs = ["tasks", "handlers", "defaults", "vars", "meta", "host_vars", "group_vars"]
  for (const dir of topLevelDirs) {
    if (lowerPath.includes(`/${dir}/`) || lowerPath.includes(`\\${dir}\\`)) {
      return true
    }
  }

  if (lowerPath.includes("/molecule/") || lowerPath.includes("\\molecule\\")) {
    return true
  }

  return false
}

function hasAnsibleProjectMarkers(filePath: string): boolean {
  const dir = dirname(resolve(filePath))
  const markers = ["ansible.cfg", "galaxy.yml", "galaxy.yaml", "requirements.yml", "requirements.yaml", "inventories"]

  for (const marker of markers) {
    if (existsSync(join(dir, marker))) {
      return true
    }
  }

  let currentDir = dir
  let depth = 0
  while (depth < 3) {
    const parent = dirname(currentDir)
    if (parent === currentDir) break
    currentDir = parent
    for (const marker of markers) {
      if (existsSync(join(currentDir, marker))) {
        return true
      }
    }
    depth++
  }

  return false
}

export function getLanguageIdForPath(filePath: string): string {
  const ext = extname(filePath)

  if (ext === ".yml" || ext === ".yaml") {
    if (detectAnsibleFile(filePath)) {
      return "ansible"
    }
    return "yaml"
  }

  if (hasExplicitAnsibleExtension(filePath.toLowerCase())) {
    return "ansible"
  }

  return getLanguageId(ext)
}
