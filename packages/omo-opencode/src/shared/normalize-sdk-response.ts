export interface NormalizeSDKResponseOptions {
  preferResponseOnMissingData?: boolean
}

/**
 * Guards the caller's declared shape.
 *
 * `preferResponseOnMissingData` exists for hosts that return a bare payload instead of a
 * `{ data }` envelope, and it is deliberately permissive - which makes it possible to hand back a
 * value that contradicts `TData`. An error envelope such as `{ data: null, error: "..." }` resolves
 * where the caller declared `Todo[]`. The call site cannot defend itself, because the type system
 * already said the value was safe; it throws on the first array method instead.
 *
 * Array-ness of `fallback` is therefore treated as the contract: a caller that asked for a list
 * always gets a list, and a caller that asked for a record never gets a list.
 */
function matchesFallbackShape<TData>(value: unknown, fallback: TData): boolean {
  return Array.isArray(value) === Array.isArray(fallback)
}

export function normalizeSDKResponse<TData>(
  response: unknown,
  fallback: TData,
  options?: NormalizeSDKResponseOptions,
): TData {
  if (response == null) {
    return fallback
  }

  if (Array.isArray(response)) {
    return matchesFallbackShape(response, fallback) ? (response as TData) : fallback
  }

  if (typeof response === "object" && "data" in response) {
    const data = (response as { data?: unknown }).data
    if (data != null) {
      return matchesFallbackShape(data, fallback) ? (data as TData) : fallback
    }

    if (options?.preferResponseOnMissingData === true) {
      return matchesFallbackShape(response, fallback) ? (response as TData) : fallback
    }

    return fallback
  }

  if (options?.preferResponseOnMissingData === true) {
    return matchesFallbackShape(response, fallback) ? (response as TData) : fallback
  }

  return fallback
}
