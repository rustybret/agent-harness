export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

export function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), min), max)
}

export function label(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0) return fallback
  return value.slice(0, maxLength)
}
