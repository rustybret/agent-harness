import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import { registerProjectMailboxCommand } from "./tui-command"
import { rm, mkdir, writeFile, readFile, realpath } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { clearPluginConfigFileDetectionCache } from "../../../shared/jsonc-parser"

describe("registerProjectMailboxCommand", () => {
  let tempDir: string
  let registryPath: string
  let api: any

  beforeEach(async () => {
    tempDir = join(tmpdir(), `omo-mailbox-test-${randomUUID()}`)
    await mkdir(tempDir, { recursive: true })
    // A dedicated per-test registry file keeps writes off the real
    // ~/.omo/project-registry.json (registerProjectMailboxCommand defaults
    // there when no override is given).
    registryPath = join(tempDir, "test-project-registry.json")
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
    registerProjectMailboxCommand({}, { directory: tempDir, registryPath })
    // No throw, just returns
  })

  it("registers the command nested under Layer.commands with a palette namespace", async () => {
    registerProjectMailboxCommand(api, { directory: tempDir, registryPath })
    expect(api.keymap.registerLayer).toHaveBeenCalled()

    const layer = api.keymap.registerLayer.mock.calls[0][0]
    expect(layer.commands).toHaveLength(1)

    const command = layer.commands[0]
    expect(command.name).toBe("omo.mailbox.projects")
    expect(command.slashName).toBe("project-mailbox")
    expect(command.namespace).toBe("palette")
  })

  it("handles the write path when the registered command runs", async () => {
    registerProjectMailboxCommand(api, { directory: tempDir, registryPath })
    const command = api.keymap.registerLayer.mock.calls[0][0].commands[0]

    // Run the command
    await command.run()

    // Should show top menu
    expect(api.ui.dialog.replace).toHaveBeenCalled()
    expect(api.ui.DialogSelect).toHaveBeenCalled()

    const topMenuProps = api.ui.DialogSelect.mock.calls[0][0]
    expect(topMenuProps.title).toBe("Project Mailbox")
  })

  it("#given onSelect fires with the host's wrapped-option shape #when a project and choice are selected #then the write targets the real projectId, not undefined", async () => {
    const configPath = join(tempDir, ".opencode", "oh-my-openagent.jsonc")
    await mkdir(join(tempDir, ".opencode"), { recursive: true })
    await writeFile(configPath, "{}", "utf8")

    registerProjectMailboxCommand(api, { directory: tempDir, registryPath })
    await api.keymap.registerLayer.mock.calls[0][0].commands[0].run()

    const topMenuProps = api.ui.DialogSelect.mock.calls[0][0]
    // Mirrors mapOptionCb() in opencode's tui/plugin/adapters.tsx: onSelect
    // is invoked with { value, title, description, ... }, not the bare row.
    // The top-menu value is itself tagged ({ action, row }) so the handler
    // can distinguish the "register this project" action from a project pick.
    topMenuProps.onSelect({
      value: { action: "project", row: { projectId: "project-a", label: "project-a", state: "Disabled" } },
      title: "project-a",
    })

    const subMenuProps = api.ui.DialogSelect.mock.calls[1][0]
    subMenuProps.onSelect({ value: { choice: "impl", value: "impl", label: "impl" }, title: "impl" })

    await new Promise((resolve) => setTimeout(resolve, 50))

    const updatedConfig = JSON.parse(await readFile(configPath, "utf8"))
    expect(updatedConfig.cross_project_mailbox.senders["project-a"]).toEqual({
      access: "allow",
      intent_budget: "impl",
    })
    expect(updatedConfig.cross_project_mailbox.senders.undefined).toBeUndefined()
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

    registerProjectMailboxCommand(api, { directory: tempDir, registryPath })
    await api.keymap.registerLayer.mock.calls[0][0].commands[0].run()
    
    // Simulate selecting project-a and changing to "impl". The real host
    // wraps the option in { value, title, ... } — see the onSelect comment
    // in tui-command.ts.
    const topMenuProps = api.ui.DialogSelect.mock.calls[0][0]
    const onSelectTop = topMenuProps.onSelect
    
    onSelectTop({ value: { action: "project", row: { projectId: "project-a", label: "project-a", state: "Disabled" } } })
    
    const subMenuProps = api.ui.DialogSelect.mock.calls[1][0]
    const onSelectSub = subMenuProps.onSelect
    
    onSelectSub({ value: { choice: "impl", value: "impl", label: "impl" } })
    
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

    registerProjectMailboxCommand(api, { directory: tempDir, registryPath })
    await api.keymap.registerLayer.mock.calls[0][0].commands[0].run()

    const topMenuProps = api.ui.DialogSelect.mock.calls[0][0]
    topMenuProps.onSelect({ value: { action: "project", row: { projectId: "project-a", label: "project-a", state: "Disabled" } } })

    const subMenuProps = api.ui.DialogSelect.mock.calls[1][0]
    subMenuProps.onSelect({ value: { choice: "impl", value: "impl", label: "impl" } })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(api.ui.toast).toHaveBeenCalledWith({
      title: "Mailbox Error",
      message: expect.stringContaining("Malformed JSONC configuration text"),
      variant: "error",
    })
  })

  it("#given the top menu is rendered #when the register-self action is selected #then registry.registerProject is invoked and a success toast confirms the projectId", async () => {
    registerProjectMailboxCommand(api, { directory: tempDir, registryPath })
    await api.keymap.registerLayer.mock.calls[0][0].commands[0].run()

    const topMenuProps = api.ui.DialogSelect.mock.calls[0][0]
    const registerOption = topMenuProps.options[0]
    expect(registerOption.title).toBe("Register this project")
    expect(registerOption.value).toEqual({ action: "register-self" })

    topMenuProps.onSelect({ value: { action: "register-self" } })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(api.ui.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Mailbox", variant: "success" }),
    )
    const toastCall = api.ui.toast.mock.calls.find((call: any[]) => call[0].title === "Mailbox")
    expect(toastCall[0].message).toStartWith("Registered as")

    const registryData = JSON.parse(await readFile(registryPath, "utf8"))
    expect(registryData.projects).toHaveLength(1)
    expect(registryData.projects[0].repoRoot).toBe(await realpath(tempDir))

    const rerenderedTopMenuProps = api.ui.DialogSelect.mock.calls.at(-1)![0]
    expect(rerenderedTopMenuProps.options[0].title).toStartWith("Re-register this project")
  })
})
