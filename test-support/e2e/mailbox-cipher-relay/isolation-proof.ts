import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { IsolationReport, IsolationSnapshot } from "./types"

export function realRegistryPath(): string {
  return path.join(os.homedir(), ".omo", "project-registry.json")
}

export async function snapshotRealRegistry(): Promise<IsolationSnapshot> {
  const registryPath = realRegistryPath()
  try {
    const content = await readFile(registryPath)
    return {
      path: registryPath,
      state: "present",
      sha256: createHash("sha256").update(content).digest("hex"),
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { path: registryPath, state: "missing" }
    }
    throw error
  }
}

export function compareIsolation(before: IsolationSnapshot, after: IsolationSnapshot): IsolationReport {
  return {
    before,
    after,
    unchanged: before.state === after.state && before.sha256 === after.sha256,
  }
}
