import type { CrossProjectMailboxConfig } from "../config"
import type { MailboxMessage, MailboxMode } from "../envelope/schema"
import type { ClassifyNoteDeps, ClassifyResult } from "../hooks/route-note-dispatcher"
import type { UnreadMessage } from "../mailbox/types"
import type { ProjectEntry } from "../registry/types"
import type { RouteLane } from "../router"
import type { validateInbound } from "../validation/validate-inbound"
import type { DrainBlockReason } from "../drain-gate"
import type { DigestStorePort, MailboxStorePort, RateLimiterPort } from "./delivery-pipeline"

export interface ManualDrainMailboxStorePort extends MailboxStorePort {
  ack(messageId: string): Promise<void>
}

export interface ManualMailboxToolDeps {
  config: CrossProjectMailboxConfig
  repoRoot: string
  projectDisplayName: string
  getRegisteredProjects: () => ProjectEntry[] | Promise<ProjectEntry[]>
  // Optional: when supplied, peek reports whether an automatic drain is currently gated shut and
  // why. Absent (or resolving to undefined) reads as "no active primary", which is how the drain
  // hook itself treats it.
  resolveActivePrimaryAgent?: (sessionId: string) => string | undefined | Promise<string | undefined>
  makeMailboxStore: (targetRoot: string, fromProjectId: string) => ManualDrainMailboxStorePort
  makeDigestStore: (repoRoot: string) => DigestStorePort
  makeRateLimiter: (repoRoot: string) => RateLimiterPort
  validateInbound: typeof validateInbound
  liveConfigResolver?: { resolve: () => Promise<CrossProjectMailboxConfig> }
  classifyNote?: (note: UnreadMessage, deps: ClassifyNoteDeps) => Promise<ClassifyResult>
}

export interface PendingMailboxPreview {
  fromProjectId: string
  messageId: string
  timestamp: number
  intent: MailboxMessage["intent"]
  bodyPreview: string
}

export interface DrainedMailboxNote extends PendingMailboxPreview {
  envelope: MailboxMessage
  body: string
  requestedMode?: MailboxMode
  effectiveMode?: MailboxMode
  downgradeReason?: string
  routeLane: RouteLane
  guidance: string
}

export interface SkippedMailboxNote {
  messageId: string
  reason: string
}

export interface AutoDrainStatus {
  enabled: boolean
  reason?: DrainBlockReason
  detail?: string
  activePrimary?: string
}
