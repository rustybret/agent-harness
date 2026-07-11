import os from "node:os"

import {
  readPresenceDetail,
  type PresenceDetail,
  type ReadPresenceStatusDeps,
} from "./presence-reader"

export interface PresenceCache {
  get(
    projectId: string,
    homeDir?: string,
    deps?: ReadPresenceStatusDeps,
  ): Promise<PresenceDetail>
  resolve(
    projectId: string,
    homeDir?: string,
    deps?: ReadPresenceStatusDeps,
  ): Promise<PresenceDetail>
  invalidate(projectId?: string): void
}

export function createPresenceCache(
  ttlMs = 10_000,
  options: { readonly readDetail?: typeof readPresenceDetail } = {},
): PresenceCache {
  const readDetail = options.readDetail ?? readPresenceDetail
  const cache = new Map<string, { readonly value: PresenceDetail; readonly expiresAt: number }>()
  const inFlight = new Map<string, Promise<PresenceDetail>>()

  function get(
    projectId: string,
    homeDir: string = os.homedir(),
    deps?: ReadPresenceStatusDeps,
  ): Promise<PresenceDetail> {
    const now = Date.now()
    const cached = cache.get(projectId)
    if (cached !== undefined && now < cached.expiresAt) {
      return Promise.resolve(cached.value)
    }

    const existingFlight = inFlight.get(projectId)
    if (existingFlight !== undefined) {
      return existingFlight
    }

    const flight = (async () => {
      const value = await readDetail(projectId, homeDir, deps)
      cache.set(projectId, { value, expiresAt: Date.now() + ttlMs })
      return value
    })().finally(() => {
      if (inFlight.get(projectId) === flight) {
        inFlight.delete(projectId)
      }
    })

    inFlight.set(projectId, flight)
    return flight
  }

  function invalidate(projectId?: string): void {
    if (projectId !== undefined) {
      cache.delete(projectId)
      inFlight.delete(projectId)
    } else {
      cache.clear()
      inFlight.clear()
    }
  }

  return {
    get,
    resolve: get,
    invalidate,
  }
}
