// Drives the REAL context-injector transform hook through a realistic turn sequence and counts what
// reaches the log. Mirrors the production shape: internally driven turns whose latest user message
// is synthetic, most of them with no context waiting.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

process.env.OMO_LOG_DIR = mkdtempSync(path.join(tmpdir(), "ctx-inject-qa-"))

const { ContextCollector } = await import(
  "../../packages/omo-opencode/src/features/context-injector/collector.ts"
)
const { createContextInjectorMessagesTransformHook } = await import(
  "../../packages/omo-opencode/src/features/context-injector/injector.ts"
)
const { getLogFilePath, _flushForTesting } = await import(
  "../../packages/omo-opencode/src/shared/logger.ts"
)

const TURNS = 40
const collector = new ContextCollector()
const hook = createContextInjectorMessagesTransformHook(collector)

function message(role, text, sessionID, synthetic) {
  return {
    info: {
      id: `msg_${Math.random()}`,
      sessionID,
      role,
      time: { created: Date.now() },
      agent: "sisyphus",
      model: { providerID: "test", modelID: "test" },
    },
    parts: [
      {
        id: `part_${Math.random()}`,
        sessionID,
        messageID: "msg_x",
        type: "text",
        text,
        ...(synthetic ? { synthetic: true } : {}),
      },
    ],
  }
}

const sessionID = "ses_qa_ctx"

// Phase 1: internally driven turns with NOTHING pending - the production shape.
for (let i = 0; i < TURNS; i += 1) {
  await hook["experimental.chat.messages.transform"](
    {},
    {
      messages: [
        message("user", "Real user message", sessionID, false),
        message("user", "Synthetic internal turn", sessionID, true),
      ],
    },
  )
}

// Phase 2: one turn where context WAS waiting and got held back - must still report.
collector.register(sessionID, { id: "ctx", source: "keyword-detector", content: "Context" })
await hook["experimental.chat.messages.transform"](
  {},
  {
    messages: [
      message("user", "Real user message", sessionID, false),
      message("user", "Synthetic internal turn", sessionID, true),
    ],
  },
)

_flushForTesting()
const logText = await Bun.file(getLogFilePath()).text().catch(() => "")
const lines = logText.split("\n").filter((line) => line.includes("[context-injector]"))

console.log(
  JSON.stringify(
    {
      syntheticTurnsWithNothingPending: TURNS,
      syntheticTurnsWithContextHeld: 1,
      contextInjectorLogLines: lines.length,
      heldBackReported: lines.some((line) => line.includes("held back")),
    },
    null,
    2,
  ),
)
process.exit(0)
