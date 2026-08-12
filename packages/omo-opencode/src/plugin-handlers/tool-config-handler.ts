import type { OhMyOpenCodeConfig } from "../config";
import { getAgentDisplayName, getAgentListDisplayName } from "../shared/agent-display-names";
import { isTaskSystemEnabled } from "../shared";

type AgentWithPermission = { permission?: Record<string, unknown> };

const TASK_DENIED_SUBAGENT_KEYS = [
  "librarian",
  "explore",
  "oracle",
  "multimodal-looker",
  "metis",
  "momus",
] as const;

function getConfigQuestionPermission(): string | null {
  const configContent = process.env.OPENCODE_CONFIG_CONTENT;
  if (!configContent) return null;
  try {
    const parsed = JSON.parse(configContent);
    return parsed?.permission?.question ?? null;
  } catch (error) {
    if (error instanceof Error) return null;
    return null;
  }
}

function agentByKey(
  agentResult: Record<string, unknown>,
  key: string,
  pluginConfig?: OhMyOpenCodeConfig,
): AgentWithPermission | undefined {
  return (agentResult[getAgentListDisplayName(key, pluginConfig?.agents)] ?? agentResult[getAgentDisplayName(key, pluginConfig?.agents)] ?? agentResult[key]) as
    | AgentWithPermission
    | undefined;
}

function denyTaskForAgent(
  agentResult: Record<string, unknown>,
  key: string,
  pluginConfig: OhMyOpenCodeConfig,
): void {
  const agent = agentByKey(agentResult, key, pluginConfig);
  if (!agent) return;
  agent.permission = { ...agent.permission, task: "deny" };
}

export function applyToolConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  agentResult: Record<string, unknown>;
}): void {
  const taskSystemEnabled = isTaskSystemEnabled(params.pluginConfig)
  const denyTodoTools = taskSystemEnabled
    ? { todowrite: "deny", todoread: "deny" }
    : {}

  const existingPermission = params.config.permission as Record<string, unknown> | undefined;
  const skillDeniedByHost = existingPermission?.skill === "deny";

  params.config.tools = {
    ...(params.config.tools as Record<string, unknown>),
    "grep_app_*": false,
    LspHover: false,
    LspCodeActions: false,
    LspCodeActionResolve: false,
    "task_*": false,
    teammate: false,
    ...(taskSystemEnabled
      ? { todowrite: false, todoread: false }
      : {}),
    ...(skillDeniedByHost
      ? { skill: false, skill_mcp: false }
      : {}),
  };

  const isCliRunMode = process.env.OPENCODE_CLI_RUN_MODE === "true";
  const configQuestionPermission = getConfigQuestionPermission();
  const isQuestionDisabledByPlugin = params.pluginConfig.disabled_tools?.includes("question") ?? false;
  const questionPermission =
    isQuestionDisabledByPlugin ? "deny" :
    configQuestionPermission === "deny" ? "deny" :
    isCliRunMode ? "deny" :
    "allow";

  for (const agentKey of TASK_DENIED_SUBAGENT_KEYS) {
    denyTaskForAgent(params.agentResult, agentKey, params.pluginConfig);
  }

  const librarian = agentByKey(params.agentResult, "librarian", params.pluginConfig);
  if (librarian) {
    librarian.permission = { ...librarian.permission, "grep_app_*": "allow" };
  }
  const looker = agentByKey(params.agentResult, "multimodal-looker", params.pluginConfig);
  if (looker) {
    looker.permission = { ...looker.permission, task: "deny", look_at: "deny" };
  }
  const atlas = agentByKey(params.agentResult, "atlas", params.pluginConfig);
  if (atlas) {
    atlas.permission = {
      ...atlas.permission,
      task: "allow",
      call_omo_agent: "deny",
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
      // Atlas is a pure orchestrator: its system prompt asserts "You never write
      // code yourself. You orchestrate specialists who do." Enforce that boundary
      // in CODE (stronger than prompt text) by flat-denying the mutation surface —
      // flat "deny" hides each tool entirely. Read-only sensory/discovery tools
      // (aft_search/aft_outline/aft_zoom/aft_callgraph/aft_inspect) are intentionally
      // left unlisted: they are allow-by-default and Atlas needs them to survey work.
      edit: "deny",
      write: "deny",
      aft_refactor: "deny",
      aft_import: "deny",
      aft_move: "deny",
      aft_delete: "deny",
      aft_safety: "deny",
      ast_grep_replace: "deny",
    };
  }
  const sisyphus = agentByKey(params.agentResult, "sisyphus", params.pluginConfig);
  if (sisyphus) {
    sisyphus.permission = {
      ...sisyphus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const hephaestus = agentByKey(params.agentResult, "hephaestus", params.pluginConfig);
  if (hephaestus) {
    hephaestus.permission = {
      ...hephaestus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const prometheus = agentByKey(params.agentResult, "prometheus", params.pluginConfig);
  if (prometheus) {
    prometheus.permission = {
      ...prometheus.permission,
      call_omo_agent: "deny",
      task: "allow",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
      // Granular ruleset, NOT flat "deny": OpenCode's Permission.disabled hides a tool only
      // when the LAST rule for its key is pattern "*"+deny, and its bash tool matches the WHOLE
      // raw command string (no shell parsing). An executable CANNOT be safely prefix-allowed —
      // its own flags are an unbounded surface (git --output / -c core.pager=cmd, node --eval).
      // So the ONLY allow is the mandated scaffold-plan.mjs, anchored with `"/` right after
      // node so an option can never be the effective first arg. Layered denies after it:
      // shell metacharacters, then node code-exec long-options — findLast makes any bypass hit
      // a deny, while the last non-"*" rule keeps bash VISIBLE.
      bash: {
        "*": "deny",
        "node \"/*/scaffold-plan.mjs\"*": "allow",
        "*;*": "deny",
        "*&*": "deny",
        "*|*": "deny",
        "*>*": "deny",
        "*<*": "deny",
        "*`*": "deny",
        "*$(*": "deny",
        "*\n*": "deny",
        "*--eval*": "deny",
        "*--print*": "deny",
        "*--require*": "deny",
        "*--import*": "deny",
        "*--loader*": "deny",
        "*--experimental*": "deny",
      },
      interactive_bash: "deny",
      // Flat deny hides these mutators entirely (their own permission keys, not remapped).
      // aft_* / ast_grep_replace / aft_safety use non-filePath arg shapes.
      //
      // edit/write/apply_patch are DELIBERATELY absent from this flat-deny block: Prometheus
      // legitimately needs `edit`/`write` for .omo/*.md plan files (repo convention), so a flat
      // deny would break planning. They are instead PATH-GATED by the prometheus-md-only hook
      // (BLOCKED_TOOLS=[Write,Edit,write,edit] + apply_patch patchText target parsing), which
      // confines every write to .omo/*.md. The plan's "deny edit/write" intent is satisfied by
      // that path-scoped hook, not a tool-level deny — a stronger, file-aware guarantee.
      aft_delete: "deny",
      aft_move: "deny",
      aft_refactor: "deny",
      aft_import: "deny",
      ast_grep_replace: "deny",
      aft_safety: "deny",
    };
  }
  const junior = agentByKey(params.agentResult, "sisyphus-junior", params.pluginConfig);
  if (junior) {
    junior.permission = {
      ...junior.permission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }

  params.config.permission = {
    webfetch: "allow",
    external_directory: "allow",
    ...(params.config.permission as Record<string, unknown>),
    task: "deny",
  };
}
