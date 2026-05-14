---
name: ansible-mcp
description: "Expose the Ansible MCP server from vscode-ansible as a tier-3 skill-embedded stdio MCP for playbooks, inventories, roles, and collections."
mcp:
  ansible:
    type: stdio
    command: npx
    args:
      - -y
      - "@ansible/ansible-mcp-server"
      - "--stdio"
    env:
      WORKSPACE_ROOT: "${WORKSPACE_ROOT}"
---

# Ansible MCP Skill

This skill exposes the [vscode-ansible Ansible MCP server](https://github.com/ansible/vscode-ansible/tree/main/packages/ansible-mcp-server) as a tier-3 skill-embedded MCP. It allows agents to interact with Ansible via MCP tools/resources.

## Usage

Load the skill with:
```typescript
skill(name="ansible-mcp")
```

Then invoke MCP tools via `skill_mcp`:
```typescript
skill_mcp(mcp_name="ansible", tool_name="<tool-name>", arguments={})
```

## Available MCP Tools/Resources

The `@ansible/ansible-mcp-server` package provides Ansible workspace capabilities. Exact names may vary by version.

- Tools:
  - Inspect playbooks, inventories, roles, and collections
  - Run Ansible-related checks when the server exposes execution tools
  - Surface Ansible project context to agents
- Resources:
  - Playbooks
  - Inventories
  - Roles
  - Collections

Consult the server's documentation for exact tool/resource names and schemas.

## Prerequisites

- Node.js 24+ (for npx)
- Ansible CLI tools installed:
  - `ansible` (core)
  - `ansible-lint` (for linting)
  - `ansible-navigator` (optional, for interactive execution)

Install via your package manager:
```bash
npm install -g @ansible/ansible-mcp-server
pipx install ansible-lint
```

## Environment

- The MCP server runs via `npx @ansible/ansible-mcp-server --stdio`
- `WORKSPACE_ROOT` is passed through to the server if set; otherwise the server uses its own cwd
- The server is scoped to the current session and isolated from other skills

## Notes

- This skill does NOT bundle the Ansible MCP server; it relies on the npm package being installed globally or in your PATH
- If you need to run a local build of vscode-ansible, install the package from your local source and ensure it's on your PATH
- The skill uses stdio transport for compatibility with the tier-3 MCP manager

## Troubleshooting

If tools do not appear or calls fail:
1. Verify Node.js 24+ is installed: `node --version`
2. Verify Ansible CLI tools are installed: `ansible --version`, `ansible-lint --version`
3. Try installing the MCP server globally: `npx @ansible/ansible-mcp-server --help`
4. Check skill_mcp output for server stderr/stdout if available
