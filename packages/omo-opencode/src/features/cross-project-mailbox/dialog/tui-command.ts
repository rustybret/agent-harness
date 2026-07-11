import { log } from "../../../shared/logger"
import { createLiveMailboxConfigResolver } from "../config/live-config"
import { createProjectRegistry } from "../registry"
import { buildTopMenu, buildSubmenu, applySelection, MalformedConfigError } from "./menu-model"
import { detectPluginConfigFile, clearPluginConfigFileDetectionCache } from "../../../shared/jsonc-parser"
import { autoProvisionMailboxConfig } from "../auto-provision"
import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../../../shared/plugin-identity"

let writeChain: Promise<void> = Promise.resolve()

function queueWrite(task: () => Promise<void>): Promise<void> {
  writeChain = writeChain
    .then(task)
    .catch((error) => {
      log("[mailbox-dialog] write failed", { error })
    })
  return writeChain
}

export function registerProjectMailboxCommand(api: any, deps: { directory: string }) {
  if (!api.keymap?.registerLayer || !api.ui?.DialogSelect || !api.ui?.dialog) {
    log("[mailbox-dialog] required TUI APIs absent, skipping /project-mailbox registration")
    return
  }

  const registry = createProjectRegistry()
  const resolver = createLiveMailboxConfigResolver(deps.directory, { enabled: true } as any)

  api.keymap.registerLayer({
    name: "omo.mailbox.projects",
    title: "Project Mailbox",
    slashName: "project-mailbox",
    description: "manage connected projects",
    run: async () => {
      const entries = await registry.listProjects()
      const selfEntry = entries.find((e) => e.repoRoot === deps.directory)
      const selfProjectId = selfEntry?.projectId ?? "unknown"

      const renderTopMenu = async () => {
        const config = await resolver.resolve()
        const topMenu = buildTopMenu(entries, config, selfProjectId)
        
        const options = topMenu.map((row) => ({
          title: row.label,
          description: row.state,
          value: row,
        }))

        api.ui.dialog.replace(() =>
          api.ui.DialogSelect({
            title: "Project Mailbox",
            options,
            onSelect: (selectedRow: any) => {
              const submenu = buildSubmenu(selectedRow)
              const subOptions = submenu.map((opt) => ({
                title: opt.label,
                value: opt,
              }))

              api.ui.dialog.replace(() =>
                api.ui.DialogSelect({
                  title: `Project Mailbox > ${selectedRow.label}`,
                  options: subOptions,
                  onSelect: (selectedOpt: any) => {
                    queueWrite(async () => {
                      const opencodeDirPath = join(deps.directory, ".opencode")
                      let detected = detectPluginConfigFile(opencodeDirPath, {
                        basenames: [CONFIG_BASENAME],
                        legacyBasenames: [LEGACY_CONFIG_BASENAME],
                      })

                      if (detected.format === "none") {
                        autoProvisionMailboxConfig(deps.directory)
                        detected = detectPluginConfigFile(opencodeDirPath, {
                          basenames: [CONFIG_BASENAME],
                          legacyBasenames: [LEGACY_CONFIG_BASENAME],
                        })
                      }

                      if (detected.format === "none") {
                        throw new Error("Failed to provision config file")
                      }

                      const configPath = detected.path
                      let text = ""
                      try {
                        text = await readFile(configPath, "utf8")
                      } catch (err) {
                        text = ""
                      }

                      let nextText: string
                      try {
                        nextText = applySelection(text, selectedRow.projectId, selectedOpt.choice)
                      } catch (err) {
                        if (err instanceof MalformedConfigError) {
                          api.ui.toast({
                            title: "Mailbox Error",
                            description: err.message,
                            type: "error",
                          })
                          return
                        }
                        throw err
                      }

                      const tmp = `${configPath}.${randomUUID()}.tmp`
                      await mkdir(dirname(configPath), { recursive: true })
                      await writeFile(tmp, nextText, "utf8")
                      await rename(tmp, configPath)
                      
                      clearPluginConfigFileDetectionCache()
                      resolver.invalidate()
                      
                      // Re-render top menu after successful write
                      await renderTopMenu()
                    }).catch((err) => {
                      api.ui.toast({
                        title: "Mailbox Error",
                        description: err instanceof Error ? err.message : String(err),
                        type: "error",
                      })
                    })
                  },
                })
              )
            },
          })
        )
      }

      await renderTopMenu()
    },
  })
}
