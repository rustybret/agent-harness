/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js"
import {
  MailboxSidebarController,
  MailboxSidebarTheme,
  MailboxContentModel,
  MailboxTextToken,
} from "./mailbox-sidebar-model"

export * from "./mailbox-sidebar-model"

export function MailboxSidebar(props: { readonly controller: MailboxSidebarController; readonly theme: MailboxSidebarTheme }) {
  const prefs = createMemo(() => props.controller.prefs())
  const model = createMemo(() => props.controller.contentModel(props.theme))
  return (
    <box width="100%" flexDirection="column" borderStyle="single" borderColor={props.theme.borderActive as string | undefined} padding={1}>
      <box width="100%" flexDirection="row" justifyContent="space-between" alignItems="center" onMouseDown={props.controller.toggle}>
        <box flexDirection="row" alignItems="center">
          <box paddingLeft={1} paddingRight={1} backgroundColor={props.theme.accent as string | undefined}>
            <text fg={props.controller.badgeFg(props.theme) as string | undefined}>
              <b>{`${props.controller.collapsed() ? "▶" : "▼"} ${prefs().header.label}`}</b>
            </text>
          </box>
        </box>
        {prefs().header.showVersion && <text fg={props.theme.textMuted as string | undefined}>v{props.controller.version()}</text>}
      </box>
      <MailboxRows model={model()} theme={props.theme} />
    </box>
  )
}

function MailboxRows(props: { readonly model: MailboxContentModel | null; readonly theme: MailboxSidebarTheme }) {
  if (!props.model) return null
  if (props.model.kind === "collapsed") return <text fg={props.model.tokens[0]?.fg as string | undefined}>{props.model.tokens[0]?.text ?? ""}</text>
  return <ExpandedTokens tokens={props.model.tokens} theme={props.theme} />
}

function SectionHeader(props: { readonly token: MailboxTextToken }) {
  return <box width="100%" marginTop={1}><text fg={props.token.fg as string | undefined}><b>{props.token.text}</b></text></box>
}

function StatRow(props: { readonly label: MailboxTextToken; readonly value: MailboxTextToken }) {
  return <box width="100%" flexDirection="row" justifyContent="space-between"><text fg={props.label.fg as string | undefined}>{props.label.text}</text><text fg={props.value.fg as string | undefined}><b>{props.value.text}</b></text></box>
}

function ProjectRows(props: { readonly tokens: readonly MailboxTextToken[]; readonly theme: MailboxSidebarTheme }) {
  if (props.tokens.length === 1) return <text fg={props.theme.textMuted as string | undefined}>{props.tokens[0]?.text ?? ""}</text>
  const rows = () => {
    const grouped: MailboxTextToken[][] = []
    for (let index = 0; index < props.tokens.length; index += 3) grouped.push(props.tokens.slice(index, index + 3))
    return grouped
  }
  return <>{rows().map((row) => <box width="100%" flexDirection="row" justifyContent="space-between"><box flexDirection="row" gap={1}><text fg={row[0]?.fg as string | undefined}>{row[0]?.text ?? ""}</text><text fg={row[1]?.fg as string | undefined}>{row[1]?.text ?? ""}</text></box><text fg={row[2]?.fg as string | undefined}>{row[2]?.text ?? ""}</text></box>)}</>
}

function tokenAt(tokens: readonly MailboxTextToken[], index: number): MailboxTextToken {
  return tokens[index] ?? { text: "", fg: undefined }
}

function ExpandedTokens(props: { readonly tokens: readonly MailboxTextToken[]; readonly theme: MailboxSidebarTheme }) {
  return <><SectionHeader token={tokenAt(props.tokens, 0)} /><StatRow label={tokenAt(props.tokens, 1)} value={tokenAt(props.tokens, 2)} /><StatRow label={tokenAt(props.tokens, 3)} value={tokenAt(props.tokens, 4)} /><SectionHeader token={tokenAt(props.tokens, 5)} /><StatRow label={tokenAt(props.tokens, 6)} value={tokenAt(props.tokens, 7)} /><StatRow label={tokenAt(props.tokens, 8)} value={tokenAt(props.tokens, 9)} /><StatRow label={tokenAt(props.tokens, 10)} value={tokenAt(props.tokens, 11)} /><SectionHeader token={tokenAt(props.tokens, 12)} /><ProjectRows tokens={props.tokens.slice(13)} theme={props.theme} /></>
}
