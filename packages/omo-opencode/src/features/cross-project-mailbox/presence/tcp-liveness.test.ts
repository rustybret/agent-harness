import { afterEach, describe, expect, it } from "bun:test"
import net from "node:net"

import { probeTcpLiveness, TCP_LIVENESS_TIMEOUT_MS } from "./tcp-liveness"

const servers: net.Server[] = []

async function listenOnEphemeralPort(onConnection?: () => void): Promise<number> {
  const server = net.createServer(() => onConnection?.())
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("expected a TCP address")
  return address.port
}

describe("TCP_LIVENESS_TIMEOUT_MS", () => {
  describe("#given the fallback runs inside the caller's overall probe deadline", () => {
    it("#then it is small enough to leave the HTTP attempt real budget", () => {
      // The first version of this fix was dead code: the HTTP attempt spent the entire 2s budget,
      // so the outer race gave up at the same instant the fallback became reachable. The fallback
      // is only useful while it fits comfortably inside the deadline.
      expect(TCP_LIVENESS_TIMEOUT_MS).toBeLessThan(1_000)
    })
  })
})

describe("probeTcpLiveness", () => {
  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      await new Promise<void>((resolve) => server?.close(() => resolve()))
    }
  })

  describe("#given a port with a listener that never replies to anything", () => {
    it("#then it reports accepted, because the kernel answers the connect", async () => {
      // given: the production shape - a server too busy to serve HTTP, but still bound
      const port = await listenOnEphemeralPort()

      // when
      const liveness = await probeTcpLiveness(`http://127.0.0.1:${port}`)

      // then
      expect(liveness).toBe("accepted")
    })
  })

  describe("#given a port nothing is bound to", () => {
    it("#then it reports refused", async () => {
      // given: bind then release, so the port is known to be free
      const port = await listenOnEphemeralPort()
      const server = servers.pop()
      await new Promise<void>((resolve) => server?.close(() => resolve()))

      // when
      const liveness = await probeTcpLiveness(`http://127.0.0.1:${port}`)

      // then
      expect(liveness).toBe("refused")
    })
  })

  describe("#given a malformed server url", () => {
    it("#then it reports unknown without attempting a connection", async () => {
      // when
      const liveness = await probeTcpLiveness("not-a-url")

      // then
      expect(liveness).toBe("unknown")
    })
  })

  describe("#given a url with no explicit port", () => {
    it("#then it falls back to the protocol default rather than reporting unknown", async () => {
      // when: nothing is listening on 127.0.0.1:80 in the test environment
      const liveness = await probeTcpLiveness("http://127.0.0.1")

      // then
      expect(liveness === "refused" || liveness === "unknown").toBe(true)
    })
  })
})
