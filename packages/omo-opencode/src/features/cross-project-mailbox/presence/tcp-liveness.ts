import net from "node:net"

export const TCP_LIVENESS_TIMEOUT_MS = 300

export type TcpLiveness = "accepted" | "refused" | "unknown"

function parseHostPort(serverUrl: string): { host: string; port: number } | null {
  try {
    const url = new URL(serverUrl)
    const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port)
    if (!Number.isInteger(port) || port <= 0) return null
    return { host: url.hostname, port }
  } catch {
    return null
  }
}

/**
 * Answers "is a process still bound to this port" without asking it to do any work.
 *
 * An HTTP health probe conflates two very different states: a peer that is GONE, and a peer that is
 * BUSY. A session mid-turn can leave the request queued past the probe deadline, and the caller then
 * reports it as unreachable while it is working normally - so the busier a peer is, the more likely
 * it is to be declared dead.
 *
 * A TCP connect is answered by the kernel accept queue rather than by the application, which
 * separates the two: `accepted` means a listener exists, `refused` means nothing is bound.
 */
export function probeTcpLiveness(
  serverUrl: string,
  timeoutMs: number = TCP_LIVENESS_TIMEOUT_MS,
): Promise<TcpLiveness> {
  const target = parseHostPort(serverUrl)
  if (target === null) return Promise.resolve("unknown")

  return new Promise<TcpLiveness>((resolve) => {
    const socket = net.connect({ host: target.host, port: target.port })
    const settle = (result: TcpLiveness): void => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => settle("unknown"))
    socket.once("connect", () => settle("accepted"))
    socket.once("error", (error: NodeJS.ErrnoException) => {
      settle(error.code === "ECONNREFUSED" ? "refused" : "unknown")
    })
  })
}
