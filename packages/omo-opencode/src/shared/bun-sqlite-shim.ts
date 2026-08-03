export type BunSqliteModule = typeof import("bun:sqlite")

export async function importBunSqlite(): Promise<BunSqliteModule | undefined> {
  if (typeof globalThis.Bun === "undefined") {
    return undefined
  }

  try {
    return await import("bun:sqlite")
  } catch (error) {
    if (error instanceof Error) {
      return undefined
    }
    throw error
  }
}
