import { stringify } from "smol-toml";
import { GENERATE, agentIdFor } from "../bindings.js";
import { renderPlaceholders } from "../placeholders.js";
import { isRestricted } from "./capabilities.js";
import { buildAgentHeader } from "./header.js";
import { agentResolver, spawnIds } from "./resolver.js";
import type { AgentWarning, GenerateAgentInput, GeneratedAgent } from "./types.js";

const toml = (key: string, value: unknown): string => stringify({ [key]: value }).trimEnd();

const multiline = (s: string): string => `"""\n${s.replaceAll("\\", "\\\\").replaceAll('"""', '""\\"')}\n"""`;

const shellDisplay = (p: string): string => p.replace(/ \*$/, "");
const list = (xs: string[]): string => xs.join(", ");

export function generateCodex(input: GenerateAgentInput): GeneratedAgent {
  const { pack, agentName, agents, bindings, model } = input;
  const spec = agents.get(agentName);
  if (!spec) throw new Error(`unknown agent "${agentName}"`);
  const binding = bindings[agentName] ?? GENERATE;
  const id = agentIdFor(pack.scope, agentName, binding);
  if (binding.kind !== "generate" || id === null) throw new Error(`agent "${agentName}" is not bound to generate`);

  const resolver = agentResolver(pack.scope, agents, bindings);
  const caps = spec.capabilities;
  const warnings: AgentWarning[] = [];

  if (spec.mode !== "subagent") {
    warnings.push({
      agent: agentName,
      harness: "codex",
      kind: "mode",
      message: `mode: ${spec.mode} — Codex has no primary agents; it can only be started as a subagent`,
    });
  }

  // Restrictions Codex can't enforce (R-AGT-5): each becomes a bullet and an "unenforced" warning.
  const restrictions: string[] = [];
  if (!caps.read) restrictions.push("Don't read files.");
  if (!caps.search) restrictions.push("Don't search files or their contents.");
  if (!caps.edit.enabled) restrictions.push("Don't edit or create files (read-only).");
  else if (isRestricted(caps.edit)) {
    if (caps.edit.allow) restrictions.push(`Edit only files matching ${list(caps.edit.allow)}.`);
    if (caps.edit.deny.length > 0) restrictions.push(`Never edit files matching ${list(caps.edit.deny)}.`);
  }
  if (isRestricted(caps.shell)) {
    if (caps.shell.allow) restrictions.push(`Run only these shell commands: ${list(caps.shell.allow.map(shellDisplay))}.`);
    if (caps.shell.deny.length > 0) restrictions.push(`Never run shell commands matching: ${list(caps.shell.deny.map(shellDisplay))}.`);
  }
  const noMcp = caps.mcp.kind === "none";
  if (!caps.web && noMcp) restrictions.push("Don't use web or MCP tools.");
  else if (!caps.web) restrictions.push("Don't use web tools.");
  else if (noMcp) restrictions.push("Don't use MCP tools.");
  if (caps.mcp.kind === "servers") restrictions.push(`Use only these MCP servers: ${list(caps.mcp.servers)}.`);
  if (!caps.questions) restrictions.push("Don't ask the user questions.");
  const ids = spawnIds(pack.scope, spec, bindings);
  restrictions.push(ids.length > 0 ? `Start only these agents: ${list(ids)}.` : "Don't start other agents.");
  for (const message of restrictions) warnings.push({ agent: agentName, harness: "codex", kind: "unenforced", message });

  let instructions = renderPlaceholders(spec.instructions, resolver).trimEnd();
  instructions += `\n\nRestrictions (not enforced by Codex; follow them strictly):\n${restrictions.map((r) => `- ${r}`).join("\n")}`;

  const modelName = model.concrete ?? model.requested[0];
  const out = [toml("name", id), toml("description", renderPlaceholders(spec.description, resolver))];
  if (modelName !== undefined) out.push(toml("model", modelName));
  if (model.effort !== undefined) out.push(toml("model_reasoning_effort", model.effort));
  out.push(`developer_instructions = ${multiline(instructions)}`);
  if (!caps.shell.enabled) out.push("", stringify({ features: { shell_tool: false } }).trimEnd());
  if (!caps.skills) out.push("", stringify({ skills: { include_instructions: false } }).trimEnd());

  const rest = `${out.join("\n")}\n`;
  const header = buildAgentHeader(
    {
      source: pack.source,
      version: pack.version,
      agent: agentName,
      binding: "generate",
      model: modelName ?? "none",
      effort: model.effort ?? "default",
    },
    rest,
  );
  return { path: `.codex/agents/${id}.toml`, content: header + rest, warnings };
}
