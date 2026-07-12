/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { MAILBOX_SLOT_ORDER } from "./slot-orders"

describe("mailbox slot ordering", () => {
  it("#given the mailbox slot order and an external slot at the Magic Context default #when sorted ascending #then the mailbox slot renders first", () => {
    // given
    const MAGIC_CONTEXT_DEFAULT_SLOT_ORDER = 200
    const slots = [
      { id: "magic-context", order: MAGIC_CONTEXT_DEFAULT_SLOT_ORDER },
      { id: "mailbox", order: MAILBOX_SLOT_ORDER },
    ]

    // when
    const sorted = [...slots].sort((left, right) => left.order - right.order)

    // then
    expect(MAILBOX_SLOT_ORDER).toBeLessThan(MAGIC_CONTEXT_DEFAULT_SLOT_ORDER)
    expect(sorted.map((slot) => slot.id)).toEqual(["mailbox", "magic-context"])
  })
})
