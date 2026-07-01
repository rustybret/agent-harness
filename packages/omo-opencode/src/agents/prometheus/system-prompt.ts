import { loadPromptSync, prometheusPromptVariants } from "@oh-my-opencode/prompts-core"

// @allow: Prometheus is explicitly excluded from cross-project coordination by design
export const PROMETHEUS_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}

function loadDefaultPrometheusPrompt(): string {
  return loadPromptSync({
    source: prometheusPromptVariants.default,
    name: "prometheus",
    variant: "default",
  }).body
}

export const PROMETHEUS_SYSTEM_PROMPT = loadDefaultPrometheusPrompt()

export function getPrometheusPrompt(model?: string, disabledTools?: readonly string[]): string {
  void model
  void disabledTools
  return PROMETHEUS_SYSTEM_PROMPT
}
