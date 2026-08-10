import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { PluginContext } from "../../../plugin/types"
import { CrossProjectMailboxConfigSchema } from "../config"
import type { PresenceRecord } from "../presence"
import { buildIdleDrainDeps, buildPresenceHeartbeatHook, loadSessionMessageIds } from "./create-mailbox-hooks"

function makeCtx(sessionApi: Record<string, unknown>): PluginContext {
  return {
    client: { session: sessionApi },
    directory: "/tmp/mailbox-hooks-test",
  } as unknown as PluginContext
}

describe("buildIdleDrainDeps", () => {
  it("#given an enabled mailbox #when hooks initialize #then it reads peers without registering the current project", () => {
    // given
    let registerCalls = 0
    const registry = {
      listProjects: async () => [],
      registerProject: async () => {
        registerCalls += 1
        return { created: true }
      },
    }

    // when
    buildIdleDrainDeps(makeCtx({}), CrossProjectMailboxConfigSchema.parse({}), registry)

    // then
    expect(registerCalls).toBe(0)
  })
})

describe("buildPresenceHeartbeatHook", () => {
  let server: ReturnType<typeof Bun.serve> | undefined
  const tmpDirs: string[] = []

  afterEach(async () => {
    server?.stop(true)
    server = undefined
    await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function makeRepoRoot(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
    tmpDirs.push(dir)
    return dir
  }

  function captureWrites(): {
    records: PresenceRecord[]
    writeRecord: (record: PresenceRecord) => Promise<void>
  } {
    const records: PresenceRecord[] = []
    return {
      records,
      writeRecord: async (record: PresenceRecord) => {
        records.push(record)
      },
    }
  }

  describe("#given the host wrote a listener-registry record for this pid", () => {
    it("#then it wires createModeDetector and writes an external record with the registry url", async () => {
      // given
      const repoRoot = await makeRepoRoot("omo-wire-ext-")
      const sessionId = "ses_wire_ext"
      const registryUrl = "http://127.0.0.1:7719/"
      const ctx = {
        directory: repoRoot,
        serverUrl: undefined,
        client: {},
      } as unknown as PluginContext
      const { records, writeRecord } = captureWrites()

      // when
      const hook = buildPresenceHeartbeatHook(ctx, {
        writeRecord,
        settleMs: 0,
        readOwnRecord: async () => ({
          pid: process.pid,
          url: registryUrl,
          hostname: "127.0.0.1",
          port: 7719,
          startedAt: Date.now(),
        }),
      })
      hook?.onSessionActive(sessionId, "start")
      await new Promise((resolve) => setTimeout(resolve, 120))

      // then
      const record = records.at(-1)
      expect(record?.mode).toBe("external")
      expect(record?.serverUrl).toBe(registryUrl)
      expect(record?.sessionId).toBe(sessionId)

      // cleanup
      hook?.dispose()
    })
  })

  describe("#given no listener record and no resolvable server url", () => {
    it("#then the detector reports internal and the heartbeat still writes a null-url record", async () => {
      // given
      const repoRoot = await makeRepoRoot("omo-wire-int-")
      const sessionId = "ses_wire_int"
      const ctx = {
        directory: repoRoot,
        serverUrl: undefined,
        client: {},
      } as unknown as PluginContext
      const { records, writeRecord } = captureWrites()

      // when
      const hook = buildPresenceHeartbeatHook(ctx, {
        writeRecord,
        settleMs: 0,
        readOwnRecord: async () => null,
      })
      hook?.onSessionActive(sessionId, "start")
      await new Promise((resolve) => setTimeout(resolve, 120))

      // then
      const record = records.at(-1)
      expect(record?.mode).toBe("internal")
      expect(record?.serverUrl).toBeNull()
      expect(record?.sessionId).toBe(sessionId)

      // cleanup
      hook?.dispose()
    })
  })
})

describe("loadSessionMessageIds", () => {
  describe("#given a client whose messages method depends on this binding", () => {
    describe("#when the loader invokes it", () => {
      it("#then preserves the session receiver so this._client stays defined", async () => {
        class SdkLikeSession {
          _client = { ok: true }

          async messages(): Promise<{ data: Array<{ info: { id: string } }> }> {
            if (this._client === undefined) {
              throw new TypeError("undefined is not an object (evaluating 'this._client')")
            }
            return { data: [{ info: { id: "msg-1" } }, { info: { id: "msg-2" } }] }
          }
        }

        const ids = await loadSessionMessageIds(makeCtx(new SdkLikeSession() as unknown as Record<string, unknown>), "ses_x")

        expect(ids).toEqual(["msg-1", "msg-2"])
      })
    })
  })

  describe("#given a client whose messages call rejects", () => {
    describe("#when the loader runs", () => {
      it("#then swallows the failure and returns an empty list", async () => {
        const ctx = makeCtx({
          messages: async () => {
            throw new TypeError("undefined is not an object (evaluating 'this._client')")
          },
        })

        const ids = await loadSessionMessageIds(ctx, "ses_x")

        expect(ids).toEqual([])
      })
    })
  })

  describe("#given a client without a messages function", () => {
    describe("#when the loader runs", () => {
      it("#then returns an empty list", async () => {
        const ids = await loadSessionMessageIds(makeCtx({}), "ses_x")

        expect(ids).toEqual([])
      })
    })
  })

  describe("#given session history containing a triage prompt with a mailbox marker", () => {
    describe("#when the loader runs", () => {
      it("#then extracts the mailbox messageId from the marker text", async () => {
        const ctx = makeCtx({
          messages: async () => ({
            data: [
              {
                info: { id: "msg-1" },
                parts: [
                  {
                    type: "text",
                    text: "Cross-project note from cloudhome\n[mailbox-message-id: f80ef361-da8a-4768-9a0f-e9047b9456a9]\n\nbody",
                  },
                ],
              },
            ],
          }),
        })

        const ids = await loadSessionMessageIds(ctx, "ses_x")

        expect(ids).toContain("msg-1")
        expect(ids).toContain("f80ef361-da8a-4768-9a0f-e9047b9456a9")
      })
    })
  })
})

import { buildClassifyNote } from "./create-mailbox-hooks"
import { setMainSession } from "../../../features/claude-code-session-state"
import type { BackgroundManager } from "../../../features/background-agent"

describe("buildClassifyNote", () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function makeRepoRoot(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
    tmpDirs.push(dir)
    return dir
  }

  it("#given a mock backgroundManager #when classifyNote is called #then launches task and returns decision", async () => {
    // given
    setMainSession("main-session-id")
    const repoRoot = await makeRepoRoot("omo-classify-")
    const mockTask = {
      id: "bg_task_1",
      status: "completed" as const,
      sessionId: "child-session-id",
    }
    let launchOptions: any
    const launch = async (opts: any) => {
      launchOptions = opts
      return mockTask
    }
    const getTask = () => mockTask
    const backgroundManager = {
      launch,
      getTask,
    } as unknown as BackgroundManager

    const messagesMock = async () => ({
      data: [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "subagent" }],
        },
      ],
    })
    const ctx = {
      client: { session: { messages: messagesMock } },
      directory: repoRoot,
    } as unknown as PluginContext
    const config = CrossProjectMailboxConfigSchema.parse({
      bounds: {
        body_digest_ttl_min: 60,
      },
    })

    // when
    const classifyNote = buildClassifyNote(ctx, config, backgroundManager)
    expect(classifyNote).toBeDefined()

    const note = {
      messageId: "msg-1",
      filePath: "/tmp/msg-1.json",
      envelope: {
        messageId: "msg-1",
        fromProjectId: "sender",
        toProjectId: "receiver",
        intent: "impl" as const,
        timestamp: 1,
      },
      body: "Please run a subagent task",
    }
    const deps = {
      senderConfig: {
        access: "allow" as const,
        intent_budget: "impl" as const,
      },
      routeContext: {
        presence: "none" as const,
      },
    }

    const result = await classifyNote!(note, deps)

    // then
    expect(launchOptions?.agent).toBe("Sisyphus-Junior")
    expect(result).toEqual({
      lane: "subagent",
      effectiveMode: "subagent",
    })
  })
})
