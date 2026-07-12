export type Color = { r: number; g: number; b: number; a?: number }

export function isColor(c: unknown): c is Color {
  return typeof c === "object" && c !== null && "r" in c && "g" in c && "b" in c
}

type ToastCapableUi = { toast: (input: unknown) => void }

export function hasToast(ui: unknown): ui is ToastCapableUi {
  return (
    typeof ui === "object" &&
    ui !== null &&
    "toast" in ui &&
    typeof (ui as { toast: unknown }).toast === "function"
  )
}
