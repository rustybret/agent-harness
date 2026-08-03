import { describe, expect, test } from "bun:test"

import type { MailboxMessage } from "../envelope/schema"
import {
  buildRemoteContractOutbound,
  CLOUDHOME_WORKER_VARIANT_CATEGORY,
  dispatchRemoteContract,
  handleRemoteCompletionReply,
  selectWorkerPrVariant,
} from "./cloudhome"
import type { ForwardAnswerInput, RoutedRemoteNote } from "./cloudhome"
import { createRemotePendingStore } from "./remote-pending-store"
import type { RemotePendingFsPort, RemotePendingRecord } from "./remote-pending-store"
import { RemoteMailboxRequestSchema } from "./schema"

function makeFakeFs(): { files: Map<string, string>; port: RemotePendingFsPort } {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  const enoent = (target: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`ENOENT: ${target}`), { code: "ENOENT" }) as NodeJS.ErrnoException
  return {
    files,
    port: {
      async mkdir(dir: string): Promise<void> {
        dirs.add(dir)
      },
      async readFile(filePath: string): Promise<string> {
        const content = files.get(filePath)
        if (content === undefined) throw enoent(filePath)
        return content
      },
      async writeFile(filePath: string, content: string): Promise<void> {
        files.set(filePath, content)
      },
      async rename(from: string, to: string): Promise<void> {
        const content = files.get(from)
        if (content === undefined) throw enoent(from)
        files.set(to, content)
        files.delete(from)
      },
      async rm(filePath: string): Promise<void> {
        if (!files.has(filePath)) throw enoent(filePath)
        files.delete(filePath)
      },
      async readdir(dir: string): Promise<string[]> {
        const prefix = dir.endsWith("/") ? dir : `${dir}/`
        const names = new Set<string>()
        for (const key of files.keys()) {
          if (!key.startsWith(prefix)) continue
          const rest = key.slice(prefix.length)
          if (!rest.includes("/")) names.add(rest)
        }
        if (names.size === 0 && !dirs.has(dir)) throw enoent(dir)
        return [...names]
      },
    },
  }
}

function makeNote(overrides: Partial<RoutedRemoteNote> = {}): RoutedRemoteNote {
  return {
    messageId: "note-original-1",
    correlationId: "corr-1",
    fromProjectId: "requester-proj",
    body: "What is the deploy status of atlas?",
    ...overrides,
  }
}

function makeReply(overrides: Partial<MailboxMessage & { body: string }> = {}): MailboxMessage & { body: string } {
  return {
    version: 1,
    messageId: "reply-1",
    timestamp: 1,
    correlationId: "corr-1",
    inReplyToMessageId: "outbound-1",
    fromProject: "cloudhome",
    toProject: "agent-harness",
    fromProjectId: "cloudhome-5aa53d2c",
    toProjectId: "agent-harness",
    intent: "question",
    priority: 0,
    hopCount: 1,
    hopPath: ["agent-harness", "cloudhome-5aa53d2c"],
    supersedes: null,
    body: "atlas is healthy on all pods",
    ...overrides,
  }
}

describe("RemoteMailboxRequestSchema", () => {
  test("#given a valid v1 request #when parsed #then it round-trips", () => {
    // given
    const request = {
      version: 1 as const,
      kind: "remote-answer" as const,
      noteRef: "note-1",
      repo: "agent-harness",
      gitRef: "main",
      payload: "question body",
      replyRouting: { toProjectId: "agent-harness", correlationId: "corr-1" },
    }
    // when
    const parsed = RemoteMailboxRequestSchema.parse(request)
    // then
    expect(parsed).toEqual(request)
  })

  test("#given gitRef omitted #when parsed #then it is optional", () => {
    // given / when
    const parsed = RemoteMailboxRequestSchema.safeParse({
      version: 1,
      kind: "remote-worker-pr",
      noteRef: "note-2",
      repo: "agent-harness",
      payload: "work order",
      replyRouting: { toProjectId: "agent-harness", correlationId: "corr-2" },
    })
    // then
    expect(parsed.success).toBe(true)
  })

  test("#given an unknown kind #when parsed #then it is rejected", () => {
    // given / when
    const parsed = RemoteMailboxRequestSchema.safeParse({
      version: 1,
      kind: "bogus",
      noteRef: "n",
      repo: "r",
      payload: "p",
      replyRouting: { toProjectId: "x", correlationId: "y" },
    })
    // then
    expect(parsed.success).toBe(false)
  })

  test("#given an extra top-level key #when parsed #then strict rejects it", () => {
    // given / when
    const parsed = RemoteMailboxRequestSchema.safeParse({
      version: 1,
      kind: "remote-answer",
      noteRef: "n",
      repo: "r",
      payload: "p",
      replyRouting: { toProjectId: "x", correlationId: "y" },
      surprise: true,
    })
    // then
    expect(parsed.success).toBe(false)
  })
})

describe("selectWorkerPrVariant (D6 declared-variant criterion)", () => {
  test("#given no declaration #when selected #then it defaults to worker-pr-local", () => {
    // given
    const note = { category: undefined }
    // when
    const variant = selectWorkerPrVariant(note, {})
    // then
    expect(variant).toBe("worker-pr-local")
  })

  test("#given a per-note cloudhome category #when selected #then it upgrades to worker-pr-cloudhome", () => {
    // given
    const note = { category: CLOUDHOME_WORKER_VARIANT_CATEGORY }
    // when
    const variant = selectWorkerPrVariant(note, {})
    // then
    expect(variant).toBe("worker-pr-cloudhome")
  })

  test("#given a per-sender cloudhome declaration #when selected #then it upgrades to worker-pr-cloudhome", () => {
    // given
    const note = { category: undefined }
    // when
    const variant = selectWorkerPrVariant(note, { worker_pr_variant: "cloudhome" })
    // then
    expect(variant).toBe("worker-pr-cloudhome")
  })

  test("#given a per-sender local declaration but note declares cloudhome #when selected #then note declaration wins", () => {
    // given
    const note = { category: CLOUDHOME_WORKER_VARIANT_CATEGORY }
    // when
    const variant = selectWorkerPrVariant(note, { worker_pr_variant: "local" })
    // then
    expect(variant).toBe("worker-pr-cloudhome")
  })

  test("#given an unrelated category #when selected #then it stays worker-pr-local", () => {
    // given
    const note = { category: "backend" }
    // when
    const variant = selectWorkerPrVariant(note, {})
    // then
    expect(variant).toBe("worker-pr-local")
  })
})

describe("buildRemoteContractOutbound", () => {
  test("#given a routed note and remote-answer kind #when built #then a valid payload is produced", () => {
    // given
    const note = makeNote()
    // when
    const request = buildRemoteContractOutbound(note, "remote-answer", {
      thisProjectId: "agent-harness",
      repo: "agent-harness",
      gitRef: "dev",
    })
    // then
    expect(request).toEqual({
      version: 1,
      kind: "remote-answer",
      noteRef: "note-original-1",
      repo: "agent-harness",
      gitRef: "dev",
      payload: "What is the deploy status of atlas?",
      replyRouting: { toProjectId: "agent-harness", correlationId: "corr-1" },
    })
  })

  test("#given no gitRef #when built #then gitRef is omitted from the payload", () => {
    // given
    const note = makeNote({ body: "implement the deploy webhook" })
    // when
    const request = buildRemoteContractOutbound(note, "remote-worker-pr", {
      thisProjectId: "agent-harness",
      repo: "agent-harness",
    })
    // then
    expect("gitRef" in request).toBe(false)
    expect(request.kind).toBe("remote-worker-pr")
    expect(request.payload).toBe("implement the deploy webhook")
  })
})

describe("dispatchRemoteContract (pending dedupe)", () => {
  test("#given a fresh note #when dispatched #then it sends once and records pending", async () => {
    // given
    const fake = makeFakeFs()
    const store = createRemotePendingStore({ baseDir: "/rp", fs: fake.port })
    const sent: unknown[] = []
    const deps = {
      store,
      sendOutbound: async (input: { request: unknown }) => {
        sent.push(input.request)
        return { outboundMessageId: "outbound-1" }
      },
      now: () => 1000,
    }
    // when
    const result = await dispatchRemoteContract(makeNote(), "remote-answer", {
      thisProjectId: "agent-harness",
      repo: "agent-harness",
    }, deps)
    // then
    expect(result).toEqual({ status: "pending-remote", deduped: false, outboundMessageId: "outbound-1" })
    expect(sent).toHaveLength(1)
    expect(await store.isPending("note-original-1")).toBe(true)
  })

  test("#given an already-pending note #when dispatched again #then no duplicate outbound is sent", async () => {
    // given
    const fake = makeFakeFs()
    const store = createRemotePendingStore({ baseDir: "/rp", fs: fake.port })
    let sendCount = 0
    const deps = {
      store,
      sendOutbound: async () => {
        sendCount += 1
        return { outboundMessageId: `outbound-${sendCount}` }
      },
    }
    const config = { thisProjectId: "agent-harness", repo: "agent-harness" }
    // when
    await dispatchRemoteContract(makeNote(), "remote-answer", config, deps)
    const second = await dispatchRemoteContract(makeNote(), "remote-answer", config, deps)
    // then
    expect(sendCount).toBe(1)
    expect(second).toEqual({ status: "pending-remote", deduped: true })
    expect(await store.isPending("note-original-1")).toBe(true)
  })
})

describe("handleRemoteCompletionReply (intake lifecycle)", () => {
  async function seedPending(store: ReturnType<typeof createRemotePendingStore>): Promise<RemotePendingRecord> {
    const record: RemotePendingRecord = {
      originalMessageId: "note-original-1",
      outboundMessageId: "outbound-1",
      originalFromProjectId: "requester-proj",
      originalCorrelationId: "corr-1",
      kind: "remote-answer",
      requestPayload: {
        version: 1,
        kind: "remote-answer",
        noteRef: "note-original-1",
        repo: "agent-harness",
        payload: "What is the deploy status of atlas?",
        replyRouting: { toProjectId: "agent-harness", correlationId: "corr-1" },
      },
      createdAt: 1000,
    }
    await store.markPending(record)
    return record
  }

  test("#given a matching threaded reply #when handled #then it acks, forwards, and clears pending", async () => {
    // given
    const fake = makeFakeFs()
    const store = createRemotePendingStore({ baseDir: "/rp", fs: fake.port })
    await seedPending(store)
    const acked: string[] = []
    const forwarded: ForwardAnswerInput[] = []
    const deps = {
      store,
      ackOriginal: async (id: string) => {
        acked.push(id)
      },
      forwardAnswer: async (input: ForwardAnswerInput) => {
        forwarded.push(input)
      },
    }
    // when
    const result = await handleRemoteCompletionReply(makeReply(), deps)
    // then
    expect(result).toEqual({ status: "completed", originalMessageId: "note-original-1" })
    expect(acked).toEqual(["note-original-1"])
    expect(forwarded).toEqual([
      {
        toProjectId: "requester-proj",
        inReplyToMessageId: "note-original-1",
        correlationId: "corr-1",
        body: "atlas is healthy on all pods",
        kind: "remote-answer",
      },
    ])
    expect(await store.isPending("note-original-1")).toBe(false)
  })

  test("#given a reply that matches no pending record #when handled #then it is ignored and pending stays intact", async () => {
    // given
    const fake = makeFakeFs()
    const store = createRemotePendingStore({ baseDir: "/rp", fs: fake.port })
    await seedPending(store)
    const forwarded: ForwardAnswerInput[] = []
    const deps = {
      store,
      ackOriginal: async () => {},
      forwardAnswer: async (input: ForwardAnswerInput) => {
        forwarded.push(input)
      },
    }
    // when
    const result = await handleRemoteCompletionReply(makeReply({ inReplyToMessageId: "unknown-outbound" }), deps)
    // then
    expect(result).toEqual({ status: "ignored", reason: "no-matching-pending" })
    expect(forwarded).toHaveLength(0)
    expect(await store.isPending("note-original-1")).toBe(true)
  })

  test("#given a reply with no inReplyToMessageId #when handled #then it is ignored", async () => {
    // given
    const fake = makeFakeFs()
    const store = createRemotePendingStore({ baseDir: "/rp", fs: fake.port })
    await seedPending(store)
    const deps = { store, ackOriginal: async () => {}, forwardAnswer: async () => {} }
    // when
    const result = await handleRemoteCompletionReply(makeReply({ inReplyToMessageId: null }), deps)
    // then
    expect(result).toEqual({ status: "ignored", reason: "reply-missing-inreplyto" })
    expect(await store.isPending("note-original-1")).toBe(true)
  })

  test("#given a matched reply with an empty body #when handled #then it is quarantined and pending stays intact", async () => {
    // given
    const fake = makeFakeFs()
    const store = createRemotePendingStore({ baseDir: "/rp", fs: fake.port })
    await seedPending(store)
    const acked: string[] = []
    const deps = {
      store,
      ackOriginal: async (id: string) => {
        acked.push(id)
      },
      forwardAnswer: async () => {},
    }
    // when
    const result = await handleRemoteCompletionReply(makeReply({ body: "   " }), deps)
    // then
    expect(result).toEqual({
      status: "quarantined",
      reason: "empty-remote-completion",
      originalMessageId: "note-original-1",
    })
    expect(acked).toHaveLength(0)
    expect(await store.isPending("note-original-1")).toBe(true)
  })
})
