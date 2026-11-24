import type { Binding } from "../bindings.js";
import type { Harness } from "../harness.js";
import type { Capabilities } from "./capabilities.js";

export type AgentMode = "subagent" | "primary" | "all";

/** A parsed, schema-valid agent definition (manifest.json + instructions.md). */
export interface AgentSpec {
  name: string;
  description: string;
  fallback: string;
  mode: AgentMode;
  /** Requested model names in order of preference; empty = the parent's model. */
  modelNames: string[];
  effort?: string;
  spawn: string[];
  capabilities: Capabilities;
  instructions: string;
}

export interface AgentWarning {
  agent: string;
  harness: Harness;
  kind: "unenforced" | "mode" | "mcp";
  message: string;
}

export interface AgentModelInput {
  /** The concrete model for this harness (OpenCode: provider/model#variant; Codex: model name). */
  concrete?: string;
  requested: string[];
  effort?: string;
}

export interface GenerateAgentInput {
  pack: { source: string; version: string; scope: string };
  agentName: string;
  agents: ReadonlyMap<string, AgentSpec>;
  /** Bindings of ALL agents in this harness. */
  bindings: Record<string, Binding>;
  model: AgentModelInput;
}

export interface GeneratedAgent {
  /** Path relative to the project root. */
  path: string;
  content: string;
  warnings: AgentWarning[];
}
