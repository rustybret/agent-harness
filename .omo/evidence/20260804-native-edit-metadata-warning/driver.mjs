// Drives the REAL tool.execute.after handler with the tool/metadata shape observed in the live log
// (native opencode `edit`, hashline_edit off) and reports whether a missing-metadata warning fires.
const { createToolExecuteAfterHandler } = await import(
  "../../packages/omo-opencode/src/plugin/tool-execute-after.ts"
)

const nativeEditMetadata = { diff: "Index: a.ts\n--- a.ts\n+++ a.ts", filediff: "...", diagnostics: {}, truncated: false }

const cases = [
  { label: "native edit, hashline_edit off (the live config)", tool: "edit", pluginConfig: {}, metadata: nativeEditMetadata },
  { label: "hashline edit, hashline_edit on, metadata missing", tool: "edit", pluginConfig: { hashline_edit: true }, metadata: {} },
  { label: "task with no stored metadata", tool: "task", pluginConfig: {}, metadata: {} },
  { label: "read (never metadata-linked)", tool: "read", pluginConfig: {}, metadata: {} },
]

const results = []
for (const testCase of cases) {
  const messages = []
  const handler = createToolExecuteAfterHandler({
    ctx: { directory: process.cwd() },
    hooks: {},
    pluginConfig: testCase.pluginConfig,
    log: (message) => messages.push(message),
  })
  await handler(
    { tool: testCase.tool, sessionID: "ses_qa_metadata", callID: `call_${testCase.tool}` },
    { title: "t", output: "Edited (+3/-1).", metadata: { ...testCase.metadata } },
  )
  results.push({
    case: testCase.label,
    warned: messages.some((m) => m.includes("Unable to recover stored metadata")),
  })
}

console.log(JSON.stringify({ results }, null, 2))
