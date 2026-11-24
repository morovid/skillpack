import type { AgentDefinition } from "../pack/agents.js";
import { normalizeCapabilities } from "./capabilities.js";
import type { AgentSpec } from "./types.js";

type Manifest = {
  description: string;
  fallback: string;
  mode?: AgentSpec["mode"];
  model?: string | { name: string | string[]; effort?: string };
  spawn?: string[];
  capabilities?: Record<string, unknown>;
};

/** Turns a loaded, schema-valid agent folder into an AgentSpec. */
export function toAgentSpec(def: AgentDefinition): AgentSpec {
  if (!def.manifest.ok) throw new Error(`agent "${def.name}" has no valid manifest`);
  const m = def.manifest.value as Manifest;
  const model = typeof m.model === "string" ? { name: m.model } : m.model;
  const spec: AgentSpec = {
    name: def.name,
    description: m.description,
    fallback: m.fallback,
    mode: m.mode ?? "subagent",
    modelNames: model === undefined ? [] : [model.name].flat(),
    spawn: m.spawn ?? [],
    capabilities: normalizeCapabilities(m.capabilities),
    instructions: def.instructions ?? "",
  };
  if (model?.effort !== undefined) spec.effort = model.effort;
  return spec;
}
