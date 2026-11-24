import { stringify } from "yaml";
import { GENERATE, agentIdFor } from "../bindings.js";
import { renderPlaceholders } from "../placeholders.js";
import type { Capabilities, ScopedCapability } from "./capabilities.js";
import { buildAgentHeader } from "./header.js";
import { agentResolver, spawnIds } from "./resolver.js";
import type { AgentWarning, GenerateAgentInput, GeneratedAgent } from "./types.js";

/** Capability -> OpenCode permission actions. The one place that maps them. */
export const OPENCODE_ACTIONS = {
  read: ["read"],
  search: ["glob", "grep"],
  edit: ["edit"],
  shell: ["shell"],
  web: ["webfetch", "websearch"],
  skills: ["skill"],
  questions: ["question"],
  /** MCP servers: one `<server>_*` action each. */
  mcp: (server: string) => `${server}_*`,
  spawn: "subagent",
} as const;

export interface Permission {
  action: string;
  resource: string;
  effect: "allow" | "deny";
}

/** Deny everything, allow what's listed, then apply the denials (R-AGT-3). */
export function opencodePermissions(caps: Capabilities, spawn: string[]): Permission[] {
  const out: Permission[] = [{ action: "*", resource: "*", effect: "deny" }];
  const allow = (action: string, resource = "*"): void => void out.push({ action, resource, effect: "allow" });
  const scoped = (s: ScopedCapability, action: string): void => {
    if (!s.enabled) return;
    for (const r of s.allow ?? ["*"]) allow(action, r);
  };
  if (caps.read) OPENCODE_ACTIONS.read.forEach((a) => allow(a));
  if (caps.search) OPENCODE_ACTIONS.search.forEach((a) => allow(a));
  scoped(caps.edit, OPENCODE_ACTIONS.edit[0]);
  scoped(caps.shell, OPENCODE_ACTIONS.shell[0]);
  if (caps.web) OPENCODE_ACTIONS.web.forEach((a) => allow(a));
  if (caps.skills) OPENCODE_ACTIONS.skills.forEach((a) => allow(a));
  if (caps.questions) OPENCODE_ACTIONS.questions.forEach((a) => allow(a));
  if (caps.mcp.kind === "servers") caps.mcp.servers.forEach((s) => allow(OPENCODE_ACTIONS.mcp(s)));
  for (const id of spawn) allow(OPENCODE_ACTIONS.spawn, id);
  for (const [s, action] of [[caps.edit, "edit"], [caps.shell, "shell"]] as const) {
    if (s.enabled) for (const r of s.deny) out.push({ action, resource: r, effect: "deny" });
  }
  return out;
}

const bare = (s: string): string => (/^[A-Za-z][A-Za-z0-9_-]*$/.test(s) ? s : JSON.stringify(s));
const permissionLine = (p: Permission): string =>
  `  - { action: ${bare(p.action)}, resource: ${JSON.stringify(p.resource)}, effect: ${p.effect} }`;

const scalar = (v: string): string =>
  v.includes("\n") ? JSON.stringify(v) : stringify(v, { lineWidth: 0 }).trimEnd();

export function generateOpenCode(input: GenerateAgentInput): GeneratedAgent {
  const { pack, agentName, agents, bindings, model } = input;
  const spec = agents.get(agentName);
  if (!spec) throw new Error(`unknown agent "${agentName}"`);
  const binding = bindings[agentName] ?? GENERATE;
  const id = agentIdFor(pack.scope, agentName, binding);
  if (binding.kind !== "generate" || id === null) throw new Error(`agent "${agentName}" is not bound to generate`);

  const resolver = agentResolver(pack.scope, agents, bindings);
  const warnings: AgentWarning[] = [];
  if (spec.capabilities.mcp.kind === "all") {
    warnings.push({
      agent: agentName,
      harness: "opencode",
      kind: "mcp",
      message: "mcp: true is resolved from the OpenCode config at sync time",
    });
  }

  const lines = [`description: ${scalar(renderPlaceholders(spec.description, resolver))}`, `mode: ${spec.mode}`];
  if (model.concrete !== undefined) lines.push(`model: ${scalar(model.concrete)}`);
  else if (model.requested.length > 0) {
    const effort = model.effort ? ` (effort ${model.effort})` : "";
    lines.push(`# model: ${model.requested.join(", ")}${effort} — mapped at install`);
  }
  lines.push("permissions:");
  for (const p of opencodePermissions(spec.capabilities, spawnIds(pack.scope, spec, bindings))) lines.push(permissionLine(p));

  let body = renderPlaceholders(spec.instructions, resolver);
  if (!body.endsWith("\n")) body += "\n";
  const rest = `${lines.join("\n")}\n---\n${body}`;
  const header = buildAgentHeader(
    {
      source: pack.source,
      version: pack.version,
      agent: agentName,
      binding: "generate",
      model: (model.concrete ?? model.requested[0] ?? "none").replace(/#.*$/, ""),
      effort: model.effort ?? "default",
    },
    rest,
  );
  return { path: `.opencode/agents/${id}.md`, content: `---\n${header}${rest}`, warnings };
}
