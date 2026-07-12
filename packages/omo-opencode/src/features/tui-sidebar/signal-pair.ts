export type SolidSignals = Pick<typeof import("solid-js"), "createSignal">

// Signals must come from the HOST's solid-js instance (the OpenCode TUI rewrites
// the "solid-js" specifier to its runtime module) so the slot's children() memo
// tracks our reads and re-renders on writes. Without solid-js the sidebar still
// renders, just statically (no live updates until remount).
export function createSignalPair<T>(
  runtime: SolidSignals | null,
  initial: T,
): readonly [() => T, (value: T) => void] {
  if (runtime) {
    const [get, set] = runtime.createSignal(initial)
    return [
      get,
      (value: T): void => {
        set(() => value)
      },
    ]
  }
  let current = initial
  return [
    () => current,
    (value: T): void => {
      current = value
    },
  ]
}
