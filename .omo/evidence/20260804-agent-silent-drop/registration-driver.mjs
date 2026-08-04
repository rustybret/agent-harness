// Proves the divergence: doctor reports an effective model for hephaestus while the real
// registration path silently drops the agent for that same model.
const { maybeCreateHephaestusConfig } = await import(
  "../../packages/omo-opencode/src/agents/builtin-agents/hephaestus-agent.ts"
)
const { getModelResolutionInfoWithOverrides, collectCapabilityResolutionIssues } = await import(
  "../../packages/omo-opencode/src/cli/doctor/checks/model-resolution.ts"
)

const UNSUPPORTED = process.env.QA_MODEL ?? "anthropic/claude-opus-5"

const registered = maybeCreateHephaestusConfig({
  disabledAgents: [],
  agentOverrides: { hephaestus: { model: UNSUPPORTED } },
  availableModels: new Set([UNSUPPORTED]),
  systemDefaultModel: UNSUPPORTED,
  isFirstRunNoCache: false,
  availableAgents: [],
  availableSkills: [],
  availableCategories: [],
  mergedCategories: {},
  useTaskSystem: false,
})

const info = getModelResolutionInfoWithOverrides({
  agents: { hephaestus: { model: UNSUPPORTED } },
  categories: {},
})
const hep = info.agents.find((a) => a.name === "hephaestus")
const issues = collectCapabilityResolutionIssues(info)

console.log(JSON.stringify({
  configuredModel: UNSUPPORTED,
  registration: {
    agentRegistered: registered !== undefined,
    registeredModel: registered?.model ?? null,
  },
  doctor: {
    reportsEffectiveModel: hep?.effectiveModel ?? null,
    reportsUserOverride: hep?.userOverride ?? null,
    issuesMentioningHephaestus: issues.filter((i) =>
      (i.affects ?? []).includes("hephaestus") || i.description.includes("hephaestus")
    ).length,
  },
}, null, 2))
