// Drives the REAL idle-drain hook through a realistic poll sequence and counts what reaches the
// log. Mirrors the observed production shape: an idle session gated by an ineligible primary,
// polled repeatedly, then a note arrives, then the agent switches to an eligible one.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

process.env.OMO_LOG_DIR = mkdtempSync(path.join(tmpdir(), "drain-spam-qa-"))

const { createIdleDrainHook } = await import(
  "../../packages/omo-opencode/src/features/cross-project-mailbox/hooks/idle-drain-hook.ts"
)
const { getLogFilePath, _flushForTesting } = await import(
  "../../packages/omo-opencode/src/shared/logger.ts"
)

const POLLS = 30

function makeNote(id) {
  return {
    messageId: id,
    filePath: `/inbox/${id}.md`,
    body: "hello",
    envelope: {
      messageId: id,
      fromProjectId: "peer-1",
      fromProject: "peer",
      toProjectId: "beta",
      intent: "question",
      priority: 0,
      timestamp: new Date().toISOString(),
      supersedes: null,
      threadId: null,
      inReplyToMessageId: null,
    },
  }
}

function makeDeps(state) {
  const config = {
    enabled: true,
    default_sender_access: "allow-all",
    senders: {},
    intake_eligible_agents: ["sisyphus", "hephaestus"],
    bounds: {
      max_notes_per_drain: 5,
      reservation_ttl_ms: 120000,
      body_digest_ttl_min: 60,
      same_pair_rate_limit_per_min: 30,
    },
  }
  const store = {
    reclaimStale: async () => [],
    drainUnread: async () => state.notes,
    reserve: async () => "/inbox/.delivering.md",
    unreserve: async () => undefined,
    quarantine: async () => undefined,
    markDispatched: async () => undefined,
    ack: async () => undefined,
  }
  return {
    config,
    validatePluginConfig: () => ({ valid: true, config: { cross_project_mailbox: config } }),
    repoRoot: "/repos/beta",
    directory: "/repos/beta",
    projectDisplayName: "beta",
    client: { session: { promptAsync: async () => ({}) } },
    resolveActivePrimaryAgent: () => state.primary,
    getRegisteredProjects: () => [{ projectId: "peer-1", repoRoot: "/repos/peer", displayName: "peer" }],
    makeMailboxStore: () => store,
    makePendingStore: () => ({ addDispatchSent: async () => undefined }),
    makeDigestStore: () => ({ checkAndRecord: async () => ({ isDuplicate: false }), rollback: async () => undefined }),
    makeRateLimiter: () => ({ checkRateLimit: async () => ({ limited: false }) }),
    validateInbound: () => ({ valid: true }),
    buildTriagePrompt: () => "TRIAGE",
    dispatchInternalPrompt: async () => ({ status: "dispatched", response: {} }),
    getSessionMessages: async () => [],
  }
}

const state = { primary: "prometheus", notes: [makeNote("11111111-1111-1111-1111-111111111111")] }
const hook = createIdleDrainHook(makeDeps(state))

// Phase 1: steady gated state, polled repeatedly - the production shape.
for (let i = 0; i < POLLS; i += 1) await hook["session.idle"]({ sessionId: "ses_qa" })
// Phase 2: a second note arrives. The held count changed, so this must report.
state.notes = [makeNote("11111111-1111-1111-1111-111111111111"), makeNote("22222222-2222-2222-2222-222222222222")]
for (let i = 0; i < POLLS; i += 1) await hook["session.idle"]({ sessionId: "ses_qa" })
// Phase 3: a second, different session is gated. Must report its own first skip.
for (let i = 0; i < POLLS; i += 1) await hook["session.idle"]({ sessionId: "ses_other" })

_flushForTesting()
const logText = await Bun.file(getLogFilePath()).text().catch(() => "")
const lines = logText.split("\n").filter((line) => line.includes("[mailbox-idle-drain] skipped"))

console.log(
  JSON.stringify(
    {
      pollsPerPhase: POLLS,
      totalPolls: POLLS * 3,
      skipLogLines: lines.length,
      distinctSignatures: new Set(
        lines.map((line) => line.replace(/^\[[^\]]*\]\s*/, "")),
      ).size,
    },
    null,
    2,
  ),
)
process.exit(0)
