export const GOOGLE_API_KEY_ENV = "GLOBAL_GEMINI_KEY"

const GOOGLE_KEYCHAIN_SERVICES = ["opencode-gemini-key", "cloudhome-gemini-key"] as const

export type ProviderConfig = {
  readonly npm: string
  readonly name?: string
  readonly options: Record<string, string>
  readonly models: Record<string, Record<string, string>>
}

export type ModelConfig = {
  readonly fullModel: string
  readonly providerId: string
  readonly provider: ProviderConfig
}

function trimSecretOutput(output: Uint8Array): string | undefined {
  const value = new TextDecoder().decode(output).trim()
  return value === "" ? undefined : value
}

function findKeychainSecret(service: string): string | undefined {
  const result = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-w"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!result.success) return undefined
  return trimSecretOutput(result.stdout)
}

export function resolveGoogleApiKey(explicit: string | undefined = undefined): string | undefined {
  if (explicit !== undefined && explicit !== "") return explicit

  const environmentValue = process.env[GOOGLE_API_KEY_ENV]
  if (environmentValue !== undefined && environmentValue !== "") return environmentValue

  for (const service of GOOGLE_KEYCHAIN_SERVICES) {
    const secret = findKeychainSecret(service)
    if (secret !== undefined) return secret
  }
  return undefined
}

export function modelConfigFor(model: string): ModelConfig {
  if (model.startsWith("anthropic/")) {
    const modelId = model.slice("anthropic/".length)
    return {
      fullModel: model,
      providerId: "anthropic",
      provider: {
        npm: "@ai-sdk/anthropic",
        options: {},
        models: {
          [modelId]: {
            id: modelId,
            name: modelId,
          },
        },
      },
    }
  }

  if (model.startsWith("google/")) {
    const modelId = model.slice("google/".length)
    return {
      fullModel: model,
      providerId: "google",
      provider: {
        npm: "@ai-sdk/google",
        options: {
          apiKey: `{env:${GOOGLE_API_KEY_ENV}}`,
        },
        models: {
          [modelId]: {
            id: modelId,
            name: modelId,
          },
        },
      },
    }
  }

  const modelId = model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model
  return {
    fullModel: `openrouter/${modelId}`,
    providerId: "openrouter",
    provider: {
      npm: "@ai-sdk/openai-compatible",
      name: "OpenRouter",
      options: {
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: "{env:OPENROUTER_API_KEY}",
      },
      models: {
        [modelId]: {
          name: modelId,
        },
      },
    },
  }
}
