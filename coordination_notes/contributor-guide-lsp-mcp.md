# Contributor Guide: Adding LSP and MCP Integrations

This guide explains how to add native LSP servers and Tier 3 skill-embedded MCP servers to the project.

## Adding a Native LSP Server

Native LSP servers are integrated directly into the core toolset. Use the Ansible integration as a motivating example.

### Checklist

1. **Define the Server**: Add the server to `src/tools/lsp/server-definitions.ts`.
   - Add an entry to `LSP_INSTALL_HINTS` with the installation command.
   - Add an entry to `BUILTIN_SERVERS` with the command and supported extensions.
2. **Map Extensions**: Update `src/tools/lsp/language-mappings.ts`.
   - Add the file extension to language ID mapping in `EXT_TO_LANG`.
3. **Verify Language ID**: Ensure `src/tools/lsp/language-config.ts` correctly resolves the language ID. This ID is sent to the server during `textDocument/didOpen` in `lsp-client.ts`.
4. **Path-Aware Routing**: If the server requires specific path-aware routing, check `src/tools/lsp/server-resolution.ts`.
5. **Test Integration**: Add a test case in `src/tools/lsp/` to verify the server can be resolved and spawned.

### Example: Ansible LSP

```typescript
// src/tools/lsp/server-definitions.ts
export const LSP_INSTALL_HINTS = {
  // ...
   "ansible-ls": "npm install -g @ansible/ansible-language-server",
}

export const BUILTIN_SERVERS = {
  // ...
   "ansible-ls": {
     command: ["ansible-language-server", "--stdio"], 
     extensions: [".ansible.yml", ".ansible.yaml"]
   },
}

// src/tools/lsp/language-mappings.ts
export const EXT_TO_LANG = {
  // ...
  ".yml": "yaml",
}
```

Use path-aware routing for shared extensions. For Ansible, keep `.yml` and `.yaml` mapped to `yaml` by default, then route only Ansible-specific files to `ansible-ls` in `server-resolution.ts` and send `languageId: "ansible"` from `lsp-client.ts`.

## Adding a Tier 3 Skill MCP Server

Tier 3 MCP servers are embedded within skills. This is the preferred method for local process servers.

### Checklist

1. **Skill Declaration**: Add the MCP server configuration to the YAML frontmatter of your `SKILL.md`.
2. **Transport Choice**:
   - Use `stdio` for local processes (preferred).
   - Use `http` for remote services.
3. **Security**: Ensure sensitive environment variables are handled. The `env-cleaner.ts` utility automatically strips common secret patterns.
4. **Usage**: Use the `skill_mcp` tool to invoke tools, resources, or prompts from the embedded server.

### Example: Ansible Skill MCP

```yaml
---
mcp:
  ansible:
    type: stdio
    command: npx
    args: [-y, "@ansible/ansible-mcp-server", "--stdio"]
---
```

## Verification

Always verify your changes before submitting a pull request.

1. **Type Check**: Run `bun run typecheck` to ensure no type regressions.
2. **Build**: Run `bun run build` to verify the project compiles.
3. **Tests**: Run focused tests for your changes.
   - LSP: `bun test src/tools/lsp/`
   - MCP: `bun test src/features/skill-mcp-manager/`

## Conventions

- **Bun Only**: Use Bun for all package management and script execution.
- **Strict TypeScript**: No `any` or `@ts-ignore`.
- **Test Style**: Use given/when/then structure for all new tests.
