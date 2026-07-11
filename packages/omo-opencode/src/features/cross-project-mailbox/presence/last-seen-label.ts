export const MAX_LAST_SEEN_AGE_MS = 7_776_000_000 // 90 days in milliseconds

export function lastSeenLabel(ageMs: number | null | undefined): string {
  if (
    ageMs === null ||
    ageMs === undefined ||
    typeof ageMs !== "number" ||
    Number.isNaN(ageMs) ||
    ageMs < 0 ||
    ageMs >= MAX_LAST_SEEN_AGE_MS
  ) {
    return "Last seen a long time ago"
  }

  if (ageMs < 60_000) {
    const seconds = Math.floor(ageMs / 1_000)
    return `Last seen ${seconds} ${seconds === 1 ? "second" : "seconds"} ago`
  }

  if (ageMs < 3_600_000) {
    const minutes = Math.floor(ageMs / 60_000)
    return `Last seen ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  }

  if (ageMs < 86_400_000) {
    const hours = Math.floor(ageMs / 3_600_000)
    return `Last seen ${hours} ${hours === 1 ? "hour" : "hours"} ago`
  }

  const days = Math.floor(ageMs / 86_400_000)
  return `Last seen ${days} ${days === 1 ? "day" : "days"} ago`
}
