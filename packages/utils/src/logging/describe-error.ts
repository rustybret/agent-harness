import { serializeLogData } from "./serialize-log-data"

const MAX_DESCRIPTION_LENGTH = 400

/**
 * Renders a thrown value as a readable one-line log string.
 *
 * `String(error)` is the usual shortcut, but it yields "[object Object]" for anything that is not an
 * Error and has no useful `toString` - which is exactly what SDK and transport layers reject with.
 * The result is a log line reporting that something failed while withholding what. This keeps the
 * Error path identical to before and falls back to a serialized form for everything else, so a
 * rejection carrying `{ status: 429, body: ... }` stays diagnosable.
 */
export function describeErrorForLog(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === "string") return error
  if (error === null || error === undefined) return String(error)
  if (typeof error !== "object") return String(error)

  const stringified = String(error)
  if (stringified !== "[object Object]") return truncate(stringified)

  const serialized = serializeLogData(error)
  if (serialized === undefined || serialized === "{}") return stringified
  return truncate(serialized)
}

function truncate(value: string): string {
  if (value.length <= MAX_DESCRIPTION_LENGTH) return value
  return `${value.slice(0, MAX_DESCRIPTION_LENGTH)}...`
}
