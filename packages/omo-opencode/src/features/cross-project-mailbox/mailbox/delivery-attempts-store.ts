import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"

interface AttemptsData {
  attempts: Record<string, number>
}

export class DeliveryAttemptsStore {
  constructor(private readonly targetRepoRoot: string) {}

  private get attemptsPath(): string {
    return path.join(this.targetRepoRoot, "coordination_notes", ".attempts.json")
  }

  async getAttempts(messageId: string): Promise<number> {
    const data = await this.read()
    return data.attempts[messageId] ?? 0
  }

  async incrementAttempts(messageId: string): Promise<number> {
    const data = await this.read()
    const nextCount = (data.attempts[messageId] ?? 0) + 1
    data.attempts[messageId] = nextCount
    await this.atomicWrite(data)
    return nextCount
  }

  async clearAttempts(messageId: string): Promise<void> {
    const data = await this.read()
    if (data.attempts[messageId] !== undefined) {
      delete data.attempts[messageId]
      await this.atomicWrite(data)
    }
  }

  private async read(): Promise<AttemptsData> {
    try {
      const content = await readFile(this.attemptsPath, "utf8")
      const parsed = JSON.parse(content)
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>).attempts === "object" &&
        (parsed as Record<string, unknown>).attempts !== null
      ) {
        return { attempts: (parsed as Record<string, unknown>).attempts as Record<string, number> }
      }
      return { attempts: {} }
    } catch {
      return { attempts: {} }
    }
  }

  private async atomicWrite(data: AttemptsData): Promise<void> {
    await mkdir(path.dirname(this.attemptsPath), { recursive: true, mode: 0o700 })
    const tmpPath = path.join(path.dirname(this.attemptsPath), `.tmp-attempts-${randomUUID()}.json`)
    const content = `${JSON.stringify(data, null, 2)}\n`
    try {
      const fileHandle = await open(tmpPath, "wx")
      try {
        await fileHandle.writeFile(content)
      } finally {
        await fileHandle.close()
      }
      await rename(tmpPath, this.attemptsPath)
    } catch (error) {
      await rm(tmpPath, { force: true })
      throw error
    }
  }
}
