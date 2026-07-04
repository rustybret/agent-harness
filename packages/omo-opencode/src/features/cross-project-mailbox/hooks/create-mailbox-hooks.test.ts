import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { PluginContext } from "../../../plugin/types"
import type { PresenceRecord } from "../presence"
import { buildPresenceHeartbeatHook, loadSessionMessageIds } from "./create-mailbox-hooks"

function makeCtx(sessionApi: Record<string, unknown>): PluginContext {
  return {
    client: { session: sessionApi },
    directory: "/tmp/mailbox-hooks-test",
  } as unknown as PluginContext
}

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

  describe("#given the ctx exposes a real bound server tracking the session", () => {
    it("#then it wires createModeDetector+defaultProbeSession and writes an external record", async () => {
      // given
      const repoRoot = await makeRepoRoot("omo-wire-ext-")
      const sessionId = "ses_wire_ext"
      server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/session/status") {
            return Response.json({ [sessionId]: { type: "idle" } })
          }
          return new Response("not found", { status: 404 })
        },
      })
      const serverUrl = `http://127.0.0.1:${server.port}`
      const ctx = {
        directory: repoRoot,
        serverUrl: new URL(serverUrl),
        client: {},
      } as unknown as PluginContext
      const { records, writeRecord } = captureWrites()

      // when
      const hook = buildPresenceHeartbeatHook(ctx, { writeRecord })
      hook?.onSessionActive(sessionId, "start")
      await new Promise((resolve) => setTimeout(resolve, 120))

      // then
      const record = records.at(-1)
      expect(record?.mode).toBe("external")
      expect(record?.serverUrl).toBe(new URL(serverUrl).toString())
      expect(record?.sessionId).toBe(sessionId)

      // cleanup
      hook?.dispose()
    })
  })

  describe("#given the ctx exposes no resolvable server url", () => {
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
      const hook = buildPresenceHeartbeatHook(ctx, { writeRecord })
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
