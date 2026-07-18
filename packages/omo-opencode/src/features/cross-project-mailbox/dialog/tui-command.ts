import fs from "node:fs"
import { log } from "../../../shared/logger"
import { createLiveMailboxConfigResolver } from "../config/live-config"
import { createProjectRegistry } from "../registry"
import { buildTopMenu, buildSubmenu, type TopMenuRow, type SubmenuOption } from "./menu-model"
import { applySubmenuSelection } from "./apply-submenu-selection"

let writeChain: Promise<void> = Promise.resolve()

function queueWrite(task: () => Promise<void>): Promise<void> {
  writeChain = writeChain
    .then(task)
    .catch((error) => {
      log("[mailbox-dialog] write failed", { error })
    })
  return writeChain
}

export function registerProjectMailboxCommand(
  api: any,
  deps: { directory: string; registryPath?: string },
) {
  if (!api.keymap?.registerLayer || !api.ui?.DialogSelect || !api.ui?.dialog) {
    log("[mailbox-dialog] required TUI APIs absent, skipping /project-mailbox registration")
    return
  }

  const registry = createProjectRegistry(deps.registryPath)
  const resolver = createLiveMailboxConfigResolver(deps.directory, { enabled: true } as any)

  // @opentui/keymap only recognizes commands nested under Layer.commands (its
  // RESERVED_LAYER_FIELDS allowlist is target/targetMode/priority/bindings/commands);
  // any command fields placed flat on the layer are silently dropped with no
  // error, registering an empty layer. namespace: "palette" is required for
  // slash-command search to surface the entry.
  api.keymap.registerLayer({
    commands: [
      {
        name: "omo.mailbox.projects",
        title: "Project Mailbox",
        slashName: "project-mailbox",
        desc: "manage connected projects",
        namespace: "palette",
        run: async () => {
          // registerProject() canonicalizes via fs.realpathSync before storing
          // repoRoot, so comparisons against deps.directory must canonicalize
          // too or a symlinked/uncanonicalized path (e.g. macOS /var -> /private/var)
          // will never match an existing entry, making "already registered"
          // silently look unregistered.
          let canonicalDirectory: string
          try {
            canonicalDirectory = fs.realpathSync(deps.directory)
          } catch {
            canonicalDirectory = deps.directory
          }

          let entries = await registry.listProjects()
          let selfEntry = entries.find((e) => e.repoRoot === canonicalDirectory)
          let selfProjectId = selfEntry?.projectId ?? "unknown"

          // Auto-registration was removed (a running session no longer
          // self-registers), so this menu option is the only way to add or
          // refresh this repo's entry in ~/.omo/project-registry.json.
          const registerSelf = async () => {
            try {
              const result = await registry.registerProject(deps.directory)
              entries = await registry.listProjects()
              selfEntry = entries.find((e) => e.repoRoot === canonicalDirectory)
              selfProjectId = selfEntry?.projectId ?? selfProjectId
              api.ui.toast({
                title: "Mailbox",
                message: result.created
                  ? `Registered as ${selfProjectId}`
                  : `Updated registration for ${selfProjectId}`,
                variant: "success",
              })
            } catch (err) {
              api.ui.toast({
                title: "Mailbox Error",
                message: err instanceof Error ? err.message : String(err),
                variant: "error",
              })
            }
          }

          const renderTopMenu = async () => {
            const config = await resolver.resolve()
            const topMenu = buildTopMenu(entries, config, selfProjectId)

            const registerOption = {
              title: selfEntry ? `Re-register this project (${selfProjectId})` : "Register this project",
              description: selfEntry
                ? "Refresh this session's registry entry"
                : "Add this repo to the cross-project registry",
              value: { action: "register-self" as const },
            }

            const options = [
              registerOption,
              ...topMenu.map((row) => ({
                title: row.label,
                description: row.state,
                value: { action: "project" as const, row },
              })),
            ]

            api.ui.dialog.replace(() =>
              api.ui.DialogSelect({
                title: "Project Mailbox",
                options,
                // The host's DialogSelect delivers the full option wrapper
                // ({title, value, description, ...}) to onSelect, not the
                // bare value — see mapOptionCb() in opencode's tui adapters.
                // Unwrap .value to get the tagged action/row we put there above.
                onSelect: (selected: {
                  value: { action: "register-self" } | { action: "project"; row: TopMenuRow }
                }) => {
                  const picked = selected.value
                  if (picked.action === "register-self") {
                    queueWrite(async () => {
                      await registerSelf()
                      await renderTopMenu()
                    })
                    return
                  }

                  const selectedRow = picked.row
                  const submenu = buildSubmenu(selectedRow)
                  const subOptions = submenu.map((opt) => ({
                    title: opt.label,
                    value: opt,
                  }))

                  api.ui.dialog.replace(() =>
                    api.ui.DialogSelect({
                      title: `Project Mailbox > ${selectedRow.label}`,
                      options: subOptions,
                      onSelect: (selectedSubOpt: { value: SubmenuOption }) => {
                        const selectedOpt = selectedSubOpt.value
                        queueWrite(async () => {
                          const malformedMessage = await applySubmenuSelection({
                            directory: deps.directory,
                            projectId: selectedRow.projectId,
                            choice: selectedOpt.choice,
                            resolver,
                          })
                          if (malformedMessage) {
                            api.ui.toast({ title: "Mailbox Error", message: malformedMessage, variant: "error" })
                            return
                          }
                          await renderTopMenu()
                        }).catch((err) => {
                          api.ui.toast({
                            title: "Mailbox Error",
                            message: err instanceof Error ? err.message : String(err),
                            variant: "error",
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
      },
    ],
  })
}
