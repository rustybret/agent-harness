// Drives the REAL prompt-async gate with the rejection shapes observed in the live plugin log and
// reports what the failure log line would carry. Proves the [object Object] payloads become
// diagnosable without changing the Error path.
const { configureSharedSubunitLogger } = await import("../../packages/utils/src/logger.ts")
const { dispatchInternalPrompt, releaseAllPromptAsyncReservationsForTesting } = await import(
  "../../packages/utils/src/prompt-async-gate.ts"
)

const rejections = [
  { label: "plain object (SDK rejection)", value: { status: 429, body: { message: "rate limited" } } },
  { label: "Error instance", value: new TypeError("session.messages is not a function") },
  { label: "string rejection", value: "network rejected promptAsync" },
  { label: "object with toString", value: { toString: () => "ProviderError: quota exhausted" } },
]

const results = []
for (const [index, rejection] of rejections.entries()) {
  const lines = []
  configureSharedSubunitLogger((message, data) => lines.push({ message, data }))
  const client = {
    session: {
      promptAsync: async () => {
        throw rejection.value
      },
    },
  }
  await dispatchInternalPrompt({
    mode: "async",
    client,
    sessionID: `ses_qa_${index}`,
    input: { path: { id: `ses_qa_${index}` }, body: {} },
    source: `qa:${index}`,
    settleMs: 0,
    checkStatus: false,
    checkToolState: false,
    queue: false,
  })
  const failure = lines.find((line) => line.message.includes("failed"))
  results.push({ shape: rejection.label, loggedError: failure?.data?.error ?? null })
  releaseAllPromptAsyncReservationsForTesting()
}
configureSharedSubunitLogger(undefined)

console.log(JSON.stringify({ results }, null, 2))
