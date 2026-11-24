import { findPlaceholders } from "../../../core/placeholders.js";
import { formatPointer, schemaVersion, validateAgainst } from "../../../core/schema/index.js";
import { agentRel, loadAgentDefinitions } from "../../../core/pack/index.js";
import { AGENT_INSTRUCTIONS_FILE, AGENT_MANIFEST_FILE } from "../../../core/paths.js";
import type { CheckContext } from "../context.js";
import { checkNames } from "./names.js";

export interface AgentGraphNode {
  spawn: string[];
}

const BUILTIN_IDS = /`(general|explore|default|worker|explorer)`/;

/** Returns the spawn graph of agents whose manifests are usable. */
export function checkAgents(ctx: CheckContext): { count: number; graph: Map<string, AgentGraphNode> } {
  const defs = loadAgentDefinitions(ctx.dir);
  const graph = new Map<string, AgentGraphNode>();
  for (const a of defs) ctx.agentNames.add(a.name);

  checkNames(ctx, "agent", defs.map((a) => ({ name: a.name, file: agentRel(a.name) })));

  for (const a of defs) {
    const file = agentRel(a.name, AGENT_MANIFEST_FILE);
    const m = a.manifest;
    if (!m.ok) {
      ctx.diag.error(m.reason === "missing" ? "agent-manifest-missing" : "agent-manifest-json", m.message, { file });
    } else {
      const v = schemaVersion(m.value, file);
      if ("error" in v) {
        ctx.diag.error("schema-version", v.error, { file });
      } else {
        const errors = validateAgainst("agent", m.value);
        for (const e of errors) ctx.diag.error("agent-manifest-schema", `${formatPointer(e.path)}: ${e.message}`, { file });
        if (errors.length === 0) {
          const doc = m.value as { description: string; fallback: string; spawn?: string[] };
          graph.set(a.name, { spawn: doc.spawn ?? [] });
          ctx.scans.push({ file, text: doc.description });
          if (findPlaceholders(doc.fallback).length > 0) {
            ctx.diag.error("agent-fallback-placeholder", "`fallback` must not contain placeholders", { file });
          }
          const hit = BUILTIN_IDS.exec(doc.fallback);
          if (hit) {
            ctx.diag.warn(
              "agent-fallback-harness-agent",
              `\`fallback\` names ${hit[0]}, which looks like a harness-specific agent; fallback text must be neutral`,
              { file },
            );
          }
        }
      }
    }

    const ifile = agentRel(a.name, AGENT_INSTRUCTIONS_FILE);
    if (a.instructions === null) {
      ctx.diag.error("agent-instructions-missing", "file not found", { file: ifile });
    } else if (a.instructions.trim() === "") {
      ctx.diag.error("agent-instructions-empty", "instructions must not be empty", { file: ifile });
    } else {
      ctx.scans.push({ file: ifile, text: a.instructions });
    }
  }
  return { count: defs.length, graph };
}
