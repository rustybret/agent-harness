import type { UnreadMessage } from "../mailbox/types"

export function orderForDrain(notes: UnreadMessage[], maxNotes: number): UnreadMessage[] {
  return [...notes]
    .sort(
      (left, right) =>
        right.envelope.priority - left.envelope.priority ||
        left.envelope.timestamp - right.envelope.timestamp,
    )
    .slice(0, maxNotes)
}
