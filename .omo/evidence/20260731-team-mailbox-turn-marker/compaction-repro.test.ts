/// <reference types="bun-types" />

// QA driver for the team-mailbox turn-marker collision fix.
//
// Mechanism, established empirically (an earlier draft of this driver PASSED pre-fix and was wrong):
// transitionRuntimeState compares the incoming marker against lastInjectedTurnMarker ONLY - the single
// most recent marker, not a history set. So a stale count colliding with some older turn is harmless.
// The defect needs two CONSECUTIVE polls whose message counts are equal but which are genuinely
// different turns. Then the second turn is misread as a same-turn retry and its peer message is
// silently dropped - never injected, while still counted as delivered.
//
// A steady-state message window makes this ordinary: compaction that replaces a run of messages with a
// summary plus a recent tail can land on the same length two turns running.
//
// Run from repo root:
//   bun test ./.omo/evidence/20260731-team-mailbox-turn-marker/compaction-repro.test.ts

import { afterEach, describe, expect, it } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../packages/omo-opencode/src/config/schema/team-mode"
import { sendMessage } from "../../../packages/omo-opencode/src/features/team-mode/team-mailbox/send"
import { clearTeamSessionRegistry } from "../../../packages/omo-opencode/src/features/team-mode/team-session-registry"
import { saveRuntimeState } from "../../../packages/omo-opencode/src/features/team-mode/team-state-store/store"
import type { RuntimeState } from "../../../packages/omo-opencode/src/features/team-mode/types"
import { createTeamMailboxInjector } from "../../../packages/omo-opencode/src/hooks/team-mailbox-injector/hook"

const SESSION_ID = "session-member"

type Message = {
  info: { role: string; sessionID: string; id?: string }
  parts: Array<{ type: string; text?: string; synthetic?: boolean }>
}

function createRuntimeState(teamRunId: string): RuntimeState {
  return {
    version: 1,
    teamRunId,
    teamName: "team-qa",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "lead-session",
    members: [
      {
        name: "member-a",
        sessionId: SESSION_ID,
        agentType: "general-purpose",
        status: "running",
        lastInjectedTurnMarker: undefined,
        pendingInjectedMessageIds: [],
      },
    ],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }
}

function turn(id: string, role = "user"): Message {
  return {
    info: { role, sessionID: SESSION_ID, id },
    parts: [{ type: "text", text: `turn ${id}` }],
  }
}

function injectedTexts(messages: Message[]): string[] {
  return messages
    .filter((message) => message.parts.some((part) => part.synthetic === true))
    .flatMap((message) => message.parts.map((part) => part.text ?? ""))
}

describe("team mailbox injection across a compaction cycle", () => {
  const directories: string[] = []

  afterEach(async () => {
    clearTeamSessionRegistry()
    await Promise.all(directories.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })))
  })

  it("delivers a peer message on a new turn whose message count equals the previous turn", async () => {
    // given a live member session in a team run
    const baseDir = await mkdtemp(path.join(tmpdir(), "qa-turn-marker-"))
    directories.push(baseDir)
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
    const runtimeState = createRuntimeState(randomUUID())
    await mkdir(path.join(baseDir, "runtime", runtimeState.teamRunId), { recursive: true })
    await saveRuntimeState(runtimeState, config)
    const hook = createTeamMailboxInjector({}, config)
    const transform = hook["experimental.chat.messages.transform"]
    if (transform === undefined) throw new Error("transform hook missing")

    const deliver = async (body: string, messages: Message[]): Promise<string[]> => {
      await sendMessage({
        version: 1,
        messageId: randomUUID(),
        from: "lead",
        to: "member-a",
        kind: "message",
        body,
        timestamp: Date.now(),
      }, runtimeState.teamRunId, config, { isLead: true, activeMembers: ["lead", "member-a"] })
      const output = { messages }
      await transform({ sessionID: SESSION_ID }, output)
      return injectedTexts(output.messages as Message[])
    }

    // when three consecutive turns each present a three-message window (a compacted steady state):
    // distinct messages every turn, identical count every turn
    const first = await deliver("round one", [turn("m1"), turn("m2"), turn("m3")])
    const second = await deliver("round two", [turn("m2"), turn("m3"), turn("m4")])
    const third = await deliver("round three", [turn("m3"), turn("m4"), turn("m5")])

    // then every round reaches the member; pre-fix, rounds two and three are silently dropped
    expect(first.join("\n")).toContain("round one")
    expect(second.join("\n")).toContain("round two")
    expect(third.join("\n")).toContain("round three")
  })
})
