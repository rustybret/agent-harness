import { describe, expect, it } from "bun:test"

import type { PluginContext } from "../../../plugin/types"
import { loadSessionMessageIds } from "./create-mailbox-hooks"

function makeCtx(sessionApi: Record<string, unknown>): PluginContext {
  return {
    client: { session: sessionApi },
    directory: "/tmp/mailbox-hooks-test",
  } as unknown as PluginContext
}

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
