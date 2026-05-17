import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { LSPClientTransport } from "./lsp-client-transport"

// LSPClientTransport resilience: verifies that when a spawned LSP server binary exits
// immediately (exit code 1), start() rejects with a clear JS error rather than hanging,
// leaking resources, or crashing the Bun process.
//
// Regression guard for: https://github.com/code-yeongyu/oh-my-openagent/issues/...
// Root cause: cmake-language-server (Python-based) exited immediately under Bun due to
// stdio buffering issues, causing undefined behavior in the native stream layer.
describe("LSPClientTransport resilience", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "omo-lsp-transport-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("#start", () => {
    it("#given a server binary that exits immediately with code 1 #when start is called #then rejects with an exit-code error rather than hanging or crashing", async () => {
      // #given — /usr/bin/false always exits immediately with code 1, no output
      const transport = new LSPClientTransport(tmpDir, {
        id: "test-immediate-exit",
        command: ["/usr/bin/false"],
        extensions: [".test"],
        priority: 0,
      })

      // #when / #then — must reject (not hang, not crash)
      await expect(transport.start()).rejects.toThrow(/exited immediately/)
    })

    it("#given a server binary that writes stderr then exits #when start is called #then rejects and error contains exit code info", async () => {
      // #given — mimics opencode-godot-lsp behavior: writes error to stderr, exits 1
      const transport = new LSPClientTransport(tmpDir, {
        id: "test-stderr-exit",
        command: ["sh", "-c", "echo 'fatal: not a valid project' >&2; exit 1"],
        extensions: [".gd"],
        priority: 0,
      })

      // #when / #then
      await expect(transport.start()).rejects.toThrow(/exited immediately/)
    })

    it("#given a server that exits immediately #when stop is called after failed start #then stop is safe to call", async () => {
      // #given
      const transport = new LSPClientTransport(tmpDir, {
        id: "test-stop-after-failure",
        command: ["/usr/bin/false"],
        extensions: [".test"],
        priority: 0,
      })

      // #when
      await expect(transport.start()).rejects.toThrow()

      // #then — stop() must not throw on an already-dead process
      await expect(transport.stop()).resolves.toBeUndefined()
    })
  })
})
