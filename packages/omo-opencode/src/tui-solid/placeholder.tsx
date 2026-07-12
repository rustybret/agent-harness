import { createSignal } from "solid-js"
import { jsx } from "@opentui/solid/jsx-runtime"

export function TuiSolidPlaceholder() {
  const [label] = createSignal("ready")

  return jsx("text", { children: label() })
}
