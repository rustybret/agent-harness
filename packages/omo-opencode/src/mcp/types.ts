import { z } from "zod"

// Note: "lsp" was retired as a built-in MCP (AFT is now the sole LSP engine). It is intentionally
// omitted from this enum. Backward compatibility for `disabled_mcps: ["lsp"]` in existing configs is
// preserved because `disabled_mcps` validates against AnyMcpNameSchema (z.string), not McpNameSchema.
export const McpNameSchema = z.enum(["websearch", "context7", "grep_app", "codegraph"])

export type McpName = z.infer<typeof McpNameSchema>

export const AnyMcpNameSchema = z.string().min(1)

export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>
