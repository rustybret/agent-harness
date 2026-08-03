import type { MailboxMode } from "../../../packages/omo-opencode/src/features/cross-project-mailbox/envelope/schema"

export const DEFAULT_PROJECT_COUNT = 3
export const DEFAULT_TIMEOUT_MINUTES = 15
export const DEFAULT_RELAY_MODEL = "anthropic/claude-sonnet-4-6"
export const ARBITER_PROJECT_ID = "cipher-relay-arbiter"

export interface RelayXdgPaths {
  readonly dataHome: string
  readonly configHome: string
  readonly cacheHome: string
  readonly stateHome: string
}

export interface RelayProject {
  readonly index: number
  readonly name: string
  readonly displayName: string
  readonly projectId: string
  readonly root: string
  readonly xdg: RelayXdgPaths
  readonly dbPath: string
  readonly port: number
  readonly wordsPath: string
  readonly env: Record<string, string>
  readonly serveCommand: readonly string[]
}

export interface RelayHop {
  readonly fromProjectId: string
  readonly toProjectId: string
  readonly requestedMode: MailboxMode
}

export interface RelaySandbox {
  readonly root: string
  readonly home: string
  readonly registryPath: string
  readonly arbiterDropDir: string
  readonly reportPath: string
  readonly contextPath: string
  readonly model: string
  readonly projects: readonly RelayProject[]
  readonly hops: readonly RelayHop[]
  readonly sentenceNumbers: readonly number[]
  readonly expectedSentence: string
}

export interface RelaySeed {
  readonly messageId: string
  readonly correlationId: string
  readonly filePath: string
  readonly body: RelayPayload
}

export interface RelayPayload {
  readonly version: 1
  readonly sentenceNumbers: readonly number[]
  readonly arbiterDropDir: string
  readonly finalFile: string
  readonly chain: readonly RelayPayloadHop[]
  readonly knownWords?: Record<string, string>
}

export interface RelayPayloadHop {
  readonly projectId: string
  readonly requestedMode?: MailboxMode
}

export interface RelayFinalDrop {
  readonly sentence: string
  readonly hops: readonly RelayHopReport[]
}

export interface RelayHopReport {
  readonly projectId: string
  readonly substituted: readonly number[]
  readonly requestedMode?: MailboxMode
}

export interface ArbiterReport {
  readonly passed: boolean
  readonly expected: string
  readonly actual?: string
  readonly elapsedMs: number
  readonly hops: readonly RelayHopReport[]
  readonly finalPath: string
  readonly error?: string
}

export interface IsolationSnapshot {
  readonly path: string
  readonly state: "missing" | "present"
  readonly sha256?: string
}

export interface IsolationReport {
  readonly before: IsolationSnapshot
  readonly after: IsolationSnapshot
  readonly unchanged: boolean
}

export interface SelfTestReport {
  readonly passed: boolean
  readonly sandboxRoot: string
  readonly correct: ArbiterReport
  readonly wrong: ArbiterReport
  readonly isolation: IsolationReport
  readonly externalPresenceAsserted: boolean
  readonly generatedContextPath: string
}
