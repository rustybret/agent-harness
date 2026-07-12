import { describe, expect, it } from "bun:test"

import { badgeTextColor, readableTextColorOn } from "./badge-contrast"

describe("tui sidebar badge contrast", () => {
  it("#given light and dark accent colors #when choosing readable text #then it returns contrasting foreground colors", () => {
    // given
    const lightAccent = { r: 0.95, g: 0.84, b: 0.2 }
    const darkAccent = { r: 0.08, g: 0.12, b: 0.2 }

    // when
    const lightAccentText = readableTextColorOn(lightAccent)
    const darkAccentText = readableTextColorOn(darkAccent)

    // then
    expect(lightAccentText).toBe("#000000")
    expect(darkAccentText).toBe("#ffffff")
  })

  it("#given a near-transparent badge background #when choosing badge text #then it falls back to accent contrast", () => {
    // given
    const accent = { r: 0.93, g: 0.84, b: 0.25 }
    const transparentBackground = { r: 0.01, g: 0.02, b: 0.03, a: 0.2 }

    // when
    const textColor = badgeTextColor(accent, transparentBackground)

    // then
    expect(textColor).toBe("#000000")
  })

  it("#given a low-contrast badge background #when choosing badge text #then it falls back to accent contrast", () => {
    // given
    const accent = { r: 0.1, g: 0.14, b: 0.18 }
    const nearlyEqualBackground = { r: 0.13, g: 0.16, b: 0.2, a: 1 }

    // when
    const textColor = badgeTextColor(accent, nearlyEqualBackground)

    // then
    expect(textColor).toBe("#ffffff")
  })

  it("#given an opaque distinct badge background #when choosing badge text #then it uses the supplied background", () => {
    // given
    const accent = { r: 0.1, g: 0.14, b: 0.18 }
    const background = { r: 0.9, g: 0.75, b: 0.2, a: 1 }

    // when
    const textColor = badgeTextColor(accent, background)

    // then
    expect(textColor).toBe(background)
  })
})
