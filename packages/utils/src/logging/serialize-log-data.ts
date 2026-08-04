const MAX_STACK_FRAMES = 4
const MAX_CAUSE_DEPTH = 3

type SerializedError = {
  name: string
  message: string
  stack?: string
  cause?: unknown
  errors?: unknown[]
}

/**
 * `message` and `stack` are non-enumerable on Error, so `JSON.stringify(new Error("boom"))` yields
 * `{}` and a logged error carries no information at all. This lifts the diagnostic fields onto a
 * plain object so they survive serialization.
 *
 * The stack is capped at a few frames: the origin is what makes a log line actionable, and full
 * stacks on a high-frequency path would trade one kind of log bloat for another.
 */
function serializeError(error: Error, depth: number): SerializedError {
  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
  }

  const stack = error.stack
  if (typeof stack === "string" && stack.length > 0) {
    const frames = stack.split("\n").slice(0, MAX_STACK_FRAMES + 1)
    serialized.stack = frames.join("\n")
  }

  // Own enumerable properties carry the parts callers actually branch on, such as errno `code`.
  for (const [key, value] of Object.entries(error)) {
    if (key === "name" || key === "message" || key === "stack" || key === "cause") continue
    ;(serialized as Record<string, unknown>)[key] = value
  }

  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    serialized.cause = replaceErrors(error.cause, depth + 1)
  }

  if (error instanceof AggregateError && depth < MAX_CAUSE_DEPTH) {
    serialized.errors = error.errors.map((nested: unknown) => replaceErrors(nested, depth + 1))
  }

  return serialized
}

function replaceErrors(value: unknown, depth: number): unknown {
  return value instanceof Error ? serializeError(value, depth) : value
}

/**
 * Serializes logger payload data, keeping Error objects readable.
 *
 * Returns undefined when the payload cannot be serialized at all (for example a cyclic structure),
 * so callers can skip the line rather than write a partial one.
 */
export function serializeLogData(data: unknown): string | undefined {
  try {
    return JSON.stringify(data, (_key, value: unknown) => replaceErrors(value, 0))
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}
