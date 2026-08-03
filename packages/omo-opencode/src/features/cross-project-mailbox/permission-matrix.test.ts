import { randomUUID } from "node:crypto"

import { describe, expect, it } from "bun:test"

import { CrossProjectMailboxConfigSchema, SenderConfigSchema, decideDowngrade } from "./config"
import type { CrossProjectMailboxConfig } from "./config"
import type { MailboxMessage } from "./envelope/schema"
import { MAILBOX_MODES } from "./permission-tiers"
import type { CanonicalIntent, MailboxMode } from "./permission-tiers"
import type { ProjectEntry } from "./registry/types"
import { runSendPreflight } from "./send-tool/send-preflight"
import type { SendInput } from "./send-tool/envelope-builder"
import { validateInbound } from "./validation/validate-inbound"

// The project id used as both the preflight target key and the inbound sender key.
// runSendPreflight looks senders up by input.targetProjectId; validateInbound looks
// them up by note.fromProjectId. Reusing one id keeps a single sender entry driving both.
const PROJECT_ID = "peer-project"

const CEILINGS: readonly CanonicalIntent[] = ["question", "impl", "plan"]

// Independent oracle: hand-authored subject -> required tier table. This deliberately
// does NOT import CATEGORY_TIER / AGENT_TIER / requiredTier so the matrix is a real
// external check, not a restatement of production data.
const SUBJECT_TIER: Record<string, CanonicalIntent> = {
  // canonical intents
  question: "question",
  impl: "impl",
  plan: "plan",
  // builtin categories
  quick: "impl",
  "unspecified-low": "impl",
  "unspecified-high": "plan",
  deep: "plan",
  ultrabrain: "plan",
  "visual-engineering": "plan",
  artistry: "plan",
  writing: "plan",
  // question-tier agents
  explore: "question",
  librarian: "question",
  oracle: "question",
  metis: "question",
  momus: "question",
  // legacy intent values
  "work-loop": "plan",
  review: "plan",
}

// Independent oracle for tier ranking (not production TIER_ORDER).
const RANK: Record<CanonicalIntent, number> = { question: 0, impl: 1, plan: 2 }

interface MatrixRow {
  subject: string
  ceiling: CanonicalIntent
  expectedAccept: boolean
  note?: string
}

const LEGACY_NOTE: Record<string, string> = {
  "work-loop": "legacy: canonicalizes to plan",
  review: "legacy: canonicalizes to plan",
  quick: "legacy alias + builtin category: impl",
}

function buildMatrix(): MatrixRow[] {
  const rows: MatrixRow[] = []
  for (const subject of Object.keys(SUBJECT_TIER)) {
    for (const ceiling of CEILINGS) {
      const requiredRank = RANK[SUBJECT_TIER[subject] as CanonicalIntent]
      rows.push({
        subject,
        ceiling,
        expectedAccept: requiredRank <= RANK[ceiling],
        note: LEGACY_NOTE[subject],
      })
    }
  }
  return rows
}

const matrix: MatrixRow[] = buildMatrix()

function makeConfig(ceiling: CanonicalIntent): CrossProjectMailboxConfig {
  return CrossProjectMailboxConfigSchema.parse({
    default_sender_access: "allow-none",
    senders: {
      [PROJECT_ID]: { access: "allow", intent_budget: ceiling },
    },
  })
}

const TARGET_ENTRY: ProjectEntry = {
  projectId: PROJECT_ID,
  repoRoot: "/tmp/peer",
  displayName: "Peer",
  lastSeen: 0,
}

function makeSendInput(subject: string): SendInput {
  return {
    targetProjectId: PROJECT_ID,
    // base intent is a valid MAILBOX_INTENT; the category field drives tier resolution
    // (requiredTier(category ?? intent)), so every subject flows through category.
    intent: "question",
    category: subject,
    body: "matrix probe",
  }
}

function makeInboundNote(subject: string): MailboxMessage {
  return {
    version: 1,
    messageId: randomUUID(),
    timestamp: Date.now(),
    correlationId: randomUUID(),
    inReplyToMessageId: null,
    fromProject: "Peer",
    toProject: "Self",
    fromProjectId: PROJECT_ID,
    toProjectId: "self-project",
    intent: "question",
    category: subject,
    priority: 0,
    hopCount: 0,
    hopPath: [PROJECT_ID],
    supersedes: null,
  }
}

async function senderAccepts(subject: string, ceiling: CanonicalIntent): Promise<boolean> {
  const result = await runSendPreflight(makeSendInput(subject), 0, makeConfig(ceiling), TARGET_ENTRY)
  return result.blocked === false
}

function inboundAccepts(subject: string, ceiling: CanonicalIntent): boolean {
  const result = validateInbound(makeInboundNote(subject), makeConfig(ceiling))
  return result.valid === true
}

describe("permission combination matrix", () => {
  describe("#given every (subject x ceiling) pair", () => {
    for (const row of matrix) {
      const label = `${row.subject} @ ${row.ceiling} -> ${row.expectedAccept ? "accept" : "reject"}${
        row.note ? ` (${row.note})` : ""
      }`

      describe(`#when subject=${row.subject} ceiling=${row.ceiling}`, () => {
        it(`#then sender preflight ${label}`, async () => {
          // given / when / then
          expect(await senderAccepts(row.subject, row.ceiling)).toBe(row.expectedAccept)
        })

        it(`#then inbound validation ${label}`, () => {
          // given / when / then
          expect(inboundAccepts(row.subject, row.ceiling)).toBe(row.expectedAccept)
        })
      })
    }
  })

  describe("#given the full matrix", () => {
    describe("#when counted", () => {
      it("#then covers all 18 subjects across 3 ceilings", () => {
        // given / when / then
        expect(Object.keys(SUBJECT_TIER).length).toBe(18)
        expect(matrix.length).toBe(18 * 3)
      })
    })
  })
})

describe("legacy subjects canonicalize through the gate", () => {
  describe("#given legacy values work-loop, review, quick", () => {
    describe("#when gated at their canonical ceiling and one tier below", () => {
      it("#then work-loop needs plan (accept at plan, reject at impl)", async () => {
        // given / when / then
        expect(await senderAccepts("work-loop", "plan")).toBe(true)
        expect(inboundAccepts("work-loop", "plan")).toBe(true)
        expect(await senderAccepts("work-loop", "impl")).toBe(false)
        expect(inboundAccepts("work-loop", "impl")).toBe(false)
      })

      it("#then review needs plan (accept at plan, reject at impl)", async () => {
        // given / when / then
        expect(await senderAccepts("review", "plan")).toBe(true)
        expect(inboundAccepts("review", "plan")).toBe(true)
        expect(await senderAccepts("review", "impl")).toBe(false)
        expect(inboundAccepts("review", "impl")).toBe(false)
      })

      it("#then quick needs impl (accept at impl, reject at question)", async () => {
        // given / when / then
        expect(await senderAccepts("quick", "impl")).toBe(true)
        expect(inboundAccepts("quick", "impl")).toBe(true)
        expect(await senderAccepts("quick", "question")).toBe(false)
        expect(inboundAccepts("quick", "question")).toBe(false)
      })
    })
  })
})

// decideDowngrade matrix: (mode x sender budget ceiling x allowed_modes presence)
// Independent oracle mode->tier (NOT importing MODE_TIER), so the matrix is a real check.
const MODE_ORACLE: Record<MailboxMode, CanonicalIntent> = {
  answer: "question",
  "todo-append": "impl",
  "todo-next": "impl",
  subagent: "impl",
  "worker-pr": "plan",
  interrupt: "plan",
}
const MODE_RANK: Record<CanonicalIntent, number> = { question: 0, impl: 1, plan: 2 }

type AllowlistShape = "absent" | "present-including" | "present-excluding"

function makeSenderCfg(ceiling: CanonicalIntent, mode: MailboxMode, shape: AllowlistShape) {
  if (shape === "absent") {
    return SenderConfigSchema.parse({ access: "allow", intent_budget: ceiling })
  }
  if (shape === "present-including") {
    return SenderConfigSchema.parse({ access: "allow", intent_budget: ceiling, allowed_modes: [mode] })
  }
  // present-excluding: allowlist that deliberately omits `mode`
  const others = MAILBOX_MODES.filter((m) => m !== mode)
  return SenderConfigSchema.parse({ access: "allow", intent_budget: ceiling, allowed_modes: others })
}

interface ModeMatrixRow {
  mode: MailboxMode
  ceiling: CanonicalIntent
  shape: AllowlistShape
  expectedEffective: MailboxMode | undefined
  expectedReason: string | undefined
}

function buildModeMatrix(): ModeMatrixRow[] {
  const rows: ModeMatrixRow[] = []
  const shapes: AllowlistShape[] = ["absent", "present-including", "present-excluding"]
  for (const mode of MAILBOX_MODES) {
    for (const ceiling of CEILINGS) {
      for (const shape of shapes) {
        const overBudget = MODE_RANK[MODE_ORACLE[mode]] > MODE_RANK[ceiling]
        const disallowed = shape === "present-excluding"
        let expectedEffective: MailboxMode | undefined = mode
        let expectedReason: string | undefined
        if (overBudget) {
          // budget check runs first: over-budget wins over allowlist
          expectedEffective = undefined
          expectedReason = "mode-over-budget"
        } else if (disallowed) {
          expectedEffective = undefined
          expectedReason = "mode-not-allowed"
        }
        rows.push({ mode, ceiling, shape, expectedEffective, expectedReason })
      }
    }
  }
  return rows
}

const modeMatrix: ModeMatrixRow[] = buildModeMatrix()

describe("decideDowngrade permission matrix", () => {
  describe("#given every (mode x ceiling x allowed_modes shape) cell", () => {
    for (const row of modeMatrix) {
      const outcome = row.expectedEffective === undefined ? `downgrade(${row.expectedReason})` : "keep"
      describe(`#when mode=${row.mode} ceiling=${row.ceiling} allowlist=${row.shape}`, () => {
        it(`#then ${outcome}`, () => {
          // given
          const senderCfg = makeSenderCfg(row.ceiling, row.mode, row.shape)
          // when
          const result = decideDowngrade({ requested_mode: row.mode }, senderCfg)
          // then
          expect(result.effectiveMode).toBe(row.expectedEffective)
          expect(result.downgradeReason).toBe(row.expectedReason)
        })
      })
    }
  })

  describe("#given the full mode matrix", () => {
    describe("#when counted", () => {
      it("#then covers 6 modes x 3 ceilings x 3 allowlist shapes", () => {
        // given / when / then
        expect(modeMatrix.length).toBe(6 * 3 * 3)
      })
    })
  })

  describe("#given a note carrying NO requested_mode", () => {
    describe("#when decided against any sender", () => {
      it("#then legacy path: effectiveMode undefined with NO downgradeReason", () => {
        // given
        const senderCfg = SenderConfigSchema.parse({ access: "allow", intent_budget: "plan" })
        // when
        const result = decideDowngrade({}, senderCfg)
        // then
        expect(result.effectiveMode).toBeUndefined()
        expect(result.downgradeReason).toBeUndefined()
      })
    })
  })

  describe("#given over-budget AND disallowed simultaneously", () => {
    describe("#when decided", () => {
      it("#then budget check wins: reason is mode-over-budget", () => {
        // given: interrupt (plan tier) at question ceiling, allowlist excluding interrupt
        const senderCfg = SenderConfigSchema.parse({
          access: "allow",
          intent_budget: "question",
          allowed_modes: ["answer"],
        })
        // when
        const result = decideDowngrade({ requested_mode: "interrupt" }, senderCfg)
        // then
        expect(result.effectiveMode).toBeUndefined()
        expect(result.downgradeReason).toBe("mode-over-budget")
      })
    })
  })

  describe("#given within-budget and allowlist present-including", () => {
    describe("#when decided", () => {
      it("#then mode kept with no reason", () => {
        // given
        const senderCfg = SenderConfigSchema.parse({
          access: "allow",
          intent_budget: "plan",
          allowed_modes: ["worker-pr", "answer"],
        })
        // when
        const result = decideDowngrade({ requested_mode: "worker-pr" }, senderCfg)
        // then
        expect(result.effectiveMode).toBe("worker-pr")
        expect(result.downgradeReason).toBeUndefined()
      })
    })
  })
})

describe("matrix guard", () => {
  describe("#given a deliberately flipped expected cell", () => {
    describe("#when re-evaluated against the real gates", () => {
      it("#then the flipped expectation disagrees with both gates (proving the matrix is real)", async () => {
        // given: pick a concrete row and flip its expectation
        const original = matrix.find((r) => r.subject === "deep" && r.ceiling === "question")
        expect(original).toBeDefined()
        const truth = original as MatrixRow
        const flipped: MatrixRow = { ...truth, expectedAccept: !truth.expectedAccept }

        // when: run the real gates for that cell
        const senderResult = await senderAccepts(flipped.subject, flipped.ceiling)
        const inboundResult = inboundAccepts(flipped.subject, flipped.ceiling)

        // then: the flipped expectation must NOT match reality on either gate
        expect(senderResult).not.toBe(flipped.expectedAccept)
        expect(inboundResult).not.toBe(flipped.expectedAccept)
        // and the original (unflipped) expectation DOES match reality
        expect(senderResult).toBe(truth.expectedAccept)
        expect(inboundResult).toBe(truth.expectedAccept)
      })
    })
  })
})
