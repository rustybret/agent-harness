import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import { registerProjectMailboxCommand } from "./tui-command"
import { rm, mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { clearPluginConfigFileDetectionCache } from "../../../shared/jsonc-parser"

describe("registerProjectMailboxCommand", () => {
  let tempDir: string
  let api: any

  beforeEach(async () => {
    tempDir = join(tmpdir(), `omo-mailbox-test-${randomUUID()}`)
    await mkdir(tempDir, { recursive: true })
    clearPluginConfigFileDetectionCache()

    api = {
      keymap: {
        registerLayer: mock(),
      },
      ui: {
        DialogSelect: mock((props) => props),
        dialog: {
          replace: mock((fn) => fn()),
        },
        toast: mock(),
      },
    }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("skips registration if TUI APIs are absent", () => {
    registerProjectMailboxCommand({}, { directory: tempDir })
    // No throw, just returns
  })

  it("registers the command and handles the write path", async () => {
    registerProjectMailboxCommand(api, { directory: tempDir })
    expect(api.keymap.registerLayer).toHaveBeenCalled()

    const layer = api.keymap.registerLayer.mock.calls[0][0]
    expect(layer.name).toBe("omo.mailbox.projects")

    // Run the command
    await layer.run()

    // Should show top menu
    expect(api.ui.dialog.replace).toHaveBeenCalled()
    expect(api.ui.DialogSelect).toHaveBeenCalled()

    const topMenuProps = api.ui.DialogSelect.mock.calls[0][0]
    expect(topMenuProps.title).toBe("Project Mailbox")
  })

  it("preserves JSONC comments byte-for-byte outside the edited span", async () => {
    const configPath = join(tempDir, ".opencode", "oh-my-openagent.jsonc")
    await mkdir(join(tempDir, ".opencode"), { recursive: true })
    
    const initialConfig = `// Top level comment
{
  // Mailbox config
  "cross_project_mailbox": {
    "senders": {
      "project-a": {
        "access": "deny" // Inline comment
      }
    }
  }
}
`
    await writeFile(configPath, initialConfig, "utf8")

    registerProjectMailboxCommand(api, { directory: tempDir })
    await api.keymap.registerLayer.mock.calls[0][0].run()
    
    // Simulate selecting project-a and changing to "impl"
    const topMenuProps = api.ui.DialogSelect.mock.calls[0][0]
    const onSelectTop = topMenuProps.onSelect
    
    onSelectTop({ projectId: "project-a", label: "project-a", state: "Disabled" })
    
    const subMenuProps = api.ui.DialogSelect.mock.calls[1][0]
    const onSelectSub = subMenuProps.onSelect
    
    onSelectSub({ choice: "impl", value: "impl", label: "impl" })
    
    // Wait for the write chain to complete
    await new Promise((resolve) => setTimeout(resolve, 50))
    
    const updatedConfig = await readFile(configPath, "utf8")
    expect(updatedConfig).toContain("// Top level comment")
    expect(updatedConfig).toContain("// Mailbox config")
    expect(updatedConfig).toContain("// Inline comment")
    expect(updatedConfig).toContain('"access": "allow"')
    expect(updatedConfig).toContain('"intent_budget": "impl"')
  })

  it("shows a toast with the host toast shape for malformed config errors", async () => {
    const configPath = join(tempDir, ".opencode", "oh-my-openagent.jsonc")
    await mkdir(join(tempDir, ".opencode"), { recursive: true })
    await writeFile(configPath, "{", "utf8")

    registerProjectMailboxCommand(api, { directory: tempDir })
    await api.keymap.registerLayer.mock.calls[0][0].run()

    const topMenuProps = api.ui.DialogSelect.mock.calls[0][0]
    topMenuProps.onSelect({ projectId: "project-a", label: "project-a", state: "Disabled" })

    const subMenuProps = api.ui.DialogSelect.mock.calls[1][0]
    subMenuProps.onSelect({ choice: "impl", value: "impl", label: "impl" })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(api.ui.toast).toHaveBeenCalledWith({
      title: "Mailbox Error",
      message: expect.stringContaining("Malformed JSONC configuration text"),
      variant: "error",
    })
  })
})
