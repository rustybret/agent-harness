export interface DigestEntry {
  key: string
  digest: string
  fromProjectId: string
  toProjectId: string
  correlationId: string
  recordedAt: number
  ttlMs: number
}

export interface RateLimitEntry {
  pairKey: string
  count: number
  windowStart: number
}
