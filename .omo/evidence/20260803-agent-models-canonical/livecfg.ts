// Drives the REAL config validation path against the developer's live ~/.omo/omo.jsonc,
// which the 2026-08 reasoning-unification migration rewrote into canonical `models` chains.
import { validatePluginConfig } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/config/validate"
import { readView } from "/Volumes/Topper2TB/Git/agent-harness/packages/omo-opencode/src/features/tui-sidebar/view-loader"

const root = process.argv[2] ?? process.cwd()
const v = validatePluginConfig(root)
const agents = (v.config.agents ?? {}) as Record<string, { model?: string; fallback_models?: unknown[] }>
const view = await readView(root)

console.log(JSON.stringify({
  configValid: v.valid,
  unknownKeyMessages: v.messages.filter((m) => m.includes("Unknown config key")),
  agentsWithResolvedModel: Object.entries(agents)
    .map(([name, cfg]) => ({ agent: name, model: cfg.model ?? null, fallbackCount: cfg.fallback_models?.length ?? 0 }))
    .sort((a, b) => a.agent.localeCompare(b.agent)),
  sidebarViewKind: view.kind,
}, null, 2))
