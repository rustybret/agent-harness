export class AgentPrimaryCache {
  private readonly cache = new Map<string, string>()

  observe(sessionId: string, agentName: string): void {
    this.cache.set(sessionId, agentName)
  }

  resolve(sessionId: string): string | undefined {
    return this.cache.get(sessionId)
  }

  clear(sessionId: string): void {
    this.cache.delete(sessionId)
  }
}

export const agentPrimaryCache = new AgentPrimaryCache()

export function resolveActivePrimaryAgent(sessionId: string): string | undefined {
  return agentPrimaryCache.resolve(sessionId)
}
