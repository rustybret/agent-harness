import { modify, applyEdits, parse, type ParseError } from "jsonc-parser"
import type { ProjectEntry } from "../registry/types"
import type { CrossProjectMailboxConfig } from "../config"
import { MAILBOX_CONFIG_KEY, MAILBOX_HARNESS_KEY, mailboxKeyPath } from "../config/omo-config-target"

export type SubmenuChoice = "Disabled" | "question" | "impl" | "plan"

export interface TopMenuRow {
  projectId: string
  label: string
  state: SubmenuChoice
}

export interface SubmenuOption {
  choice: SubmenuChoice
  value: SubmenuChoice
  label: string
  selected: boolean
}

export class MalformedConfigError extends Error {
  constructor(message = "Malformed JSONC configuration text") {
    super(message)
    this.name = "MalformedConfigError"
  }
}

export function buildTopMenu(
  entries: ProjectEntry[],
  config: CrossProjectMailboxConfig,
  selfProjectId: string
): TopMenuRow[] {
  const others = entries.filter((e) => e.projectId !== selfProjectId)
  others.sort((a, b) => {
    const cmp = a.displayName.localeCompare(b.displayName)
    if (cmp !== 0) return cmp
    return a.projectId.localeCompare(b.projectId)
  })

  const displayCounts = new Map<string, number>()
  for (const entry of others) {
    const bareName = entry.displayName || entry.projectId.replace(/-[0-9a-f]{8}$/i, "")
    displayCounts.set(bareName, (displayCounts.get(bareName) ?? 0) + 1)
  }

  return others.map((entry) => {
    const bareName = entry.displayName || entry.projectId.replace(/-[0-9a-f]{8}$/i, "")
    const isCollision = (displayCounts.get(bareName) ?? 0) > 1
    const label = isCollision ? entry.projectId : bareName

    const senderConfig = config.senders?.[entry.projectId]
    let state: TopMenuRow["state"] = "Disabled"

    if (senderConfig && senderConfig.access === "allow" && senderConfig.intent_budget) {
      state = senderConfig.intent_budget
    }

    return {
      projectId: entry.projectId,
      label,
      state,
    }
  })
}

export function buildSubmenu(row: TopMenuRow): SubmenuOption[] {
  const options: SubmenuChoice[] = [
    "Disabled",
    "question",
    "impl",
    "plan",
  ]

  return options.map((opt) => {
    const selected = row.state === opt
    return {
      choice: opt,
      value: opt,
      label: selected ? `✓ ${opt}` : opt,
      selected,
    }
  })
}

export function applySelection(
  configText: string,
  projectId: string,
  choice: SubmenuChoice
): string {
  let root: any = {}
  if (configText.trim() !== "") {
    const errors: ParseError[] = []
    root = parse(configText, errors)
    if (errors.length > 0) {
      throw new MalformedConfigError(
        `Malformed JSONC configuration text: ${errors.length} parse error(s)`
      )
    }
    if (root !== undefined && root !== null && (typeof root !== "object" || Array.isArray(root))) {
      throw new MalformedConfigError(
        "Malformed JSONC configuration text: root must be a JSON object"
      )
    }
    root = root || {}
  }

  const sendersPath = mailboxKeyPath("senders", projectId)
  const existingSender = root?.[MAILBOX_HARNESS_KEY]?.[MAILBOX_CONFIG_KEY]?.senders?.[projectId]
  const hasExistingIntentBudget =
    existingSender &&
    typeof existingSender === "object" &&
    !Array.isArray(existingSender) &&
    existingSender.intent_budget !== undefined

  let nextText = configText
  if (nextText.trim() === "") {
    nextText = "{}\n"
  }

  if (choice === "Disabled") {
    const editsAccess = modify(nextText, [...sendersPath, "access"], "deny", {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    nextText = applyEdits(nextText, editsAccess)

    if (!hasExistingIntentBudget) {
      const editsIntent = modify(nextText, [...sendersPath, "intent_budget"], "question", {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      })
      nextText = applyEdits(nextText, editsIntent)
    }
  } else {
    const editsAccess = modify(nextText, [...sendersPath, "access"], "allow", {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    nextText = applyEdits(nextText, editsAccess)

    const editsIntent = modify(nextText, [...sendersPath, "intent_budget"], choice, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    nextText = applyEdits(nextText, editsIntent)
  }

  return nextText
}
