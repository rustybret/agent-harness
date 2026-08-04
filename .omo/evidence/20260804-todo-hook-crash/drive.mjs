// Drives the REAL handleSessionIdle (the hook that crashed in the live log) against the exact
// response shapes a host can return for session.todo. Reports whether the hook completes or throws
// the observed "todos.filter is not a function" TypeError.
import path from "node:path"

const root = path.resolve(import.meta.dirname, "../..")
const { handleSessionIdle } = await import(
  path.join(root, "packages/omo-opencode/src/hooks/todo-continuation-enforcer/idle-event.ts")
)

function makeStore() {
  const state = { stagnationCount: 0, consecutiveFailures: 0 }
  return {
    getState: () => state,
    getExistingState: () => state,
    startPruneInterval: () => {},
    trackContinuationProgress: () => ({
      previousStagnationCount: 0,
      stagnationCount: 0,
      hasProgressed: false,
      progressSource: "none",
    }),
    resetContinuationProgress: () => {},
    cancelCountdown: () => {},
    cleanup: () => {},
    cancelAllCountdowns: () => {},
    shutdown: () => {},
  }
}

const shapes = [
  ["error envelope (data null + error)", { data: null, error: { message: "session not found" } }],
  ["bare error object", { error: "boom" }],
  ["bare object body", { foo: 1 }],
  ["string body", "not json"],
  ["proper envelope", { data: [{ id: "t1", content: "x", status: "pending", priority: "high" }] }],
  ["proper bare array", [{ id: "t1", content: "x", status: "completed", priority: "high" }]],
]

const results = []
for (const [label, todoResponse] of shapes) {
  const ctx = {
    client: {
      session: {
        messages: async () => ({ data: [] }),
        todo: async () => todoResponse,
      },
      // A pending-todo run continues past the count into the countdown toast; stubbed so the
      // driver measures the shape guard rather than the absence of a TUI.
      tui: { showToast: async () => ({}) },
    },
    directory: "/tmp/qa",
  }
  try {
    await handleSessionIdle({
      ctx,
      sessionID: `ses_qa_${results.length}`,
      sessionStateStore: makeStore(),
    })
    results.push({ shape: label, outcome: "completed" })
  } catch (error) {
    results.push({
      shape: label,
      outcome: "THREW",
      error: error instanceof Error ? `${error.name}: ${error.message.split(".")[0]}` : String(error),
    })
  }
}

console.log(
  JSON.stringify(
    { hookCrashes: results.filter((r) => r.outcome === "THREW").length, results },
    null,
    2,
  ),
)
// A pending-todo run schedules a countdown interval that would keep the process alive.
process.exit(0)
