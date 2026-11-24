import { join } from "node:path";
import { GENERATE, parseBinding, resolveBindings, type Bindings, type BindingOverrides } from "../bindings.js";
import { HARNESSES, type Harness } from "../harness.js";
import { CONFIG_FILE, SCHEMA_BASE } from "./paths.js";
import { readValidated, toJsonText, type FileState } from "./io.js";

export interface PackConfig {
  version: string;
  harnesses: Harness[];
  skills: "*" | string[];
  scope?: string;
  /** agent -> harness -> "generate" | "existing:<id>" | "none" */
  agents: Record<string, Partial<Record<Harness, string>>>;
}

export interface SelectionConfig {
  /** Keyed by normalized source, in file order. */
  packs: Record<string, PackConfig>;
  /** The document as read, so unknown keys survive a round trip (R-CFG-9). */
  raw: Record<string, unknown>;
}

export const emptyConfig = (): SelectionConfig => ({ packs: {}, raw: {} });

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function readConfig(projectDir: string): FileState<SelectionConfig> {
  return readValidated(join(projectDir, CONFIG_FILE), CONFIG_FILE, "config", true, (doc) => {
    const packs: Record<string, PackConfig> = {};
    for (const [key, p] of Object.entries(obj(doc.packs))) {
      const e = obj(p);
      const agents: PackConfig["agents"] = {};
      for (const [agent, b] of Object.entries(obj(e.agents))) {
        const entry: Partial<Record<Harness, string>> = {};
        for (const h of HARNESSES) if (typeof obj(b)[h] === "string") entry[h] = obj(b)[h] as string;
        agents[agent] = entry;
      }
      const pack: PackConfig = {
        version: e.version as string,
        harnesses: e.harnesses as Harness[],
        skills: (e.skills ?? "*") as PackConfig["skills"],
        agents,
      };
      if (typeof e.scope === "string") pack.scope = e.scope;
      packs[key] = pack;
    }
    return { packs, raw: doc };
  });
}

const PACK_KNOWN = new Set(["version", "harnesses", "skills", "scope", "agents"]);

/** Stable text: `$schema` first, packs in model order, known keys in a fixed order, unknown keys kept. */
export function serializeConfig(config: SelectionConfig): string {
  const rawPacks = obj(config.raw.packs);
  const packs: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(config.packs)) {
    const rawPack = obj(rawPacks[key]);
    const rawAgents = obj(rawPack.agents);
    const agents: Record<string, unknown> = {};
    for (const [agent, b] of Object.entries(p.agents)) {
      const entry: Record<string, unknown> = {};
      for (const h of HARNESSES) if (b[h] !== undefined) entry[h] = b[h];
      for (const [k, v] of Object.entries(obj(rawAgents[agent]))) if (!(HARNESSES as readonly string[]).includes(k)) entry[k] = v;
      agents[agent] = entry;
    }
    const out: Record<string, unknown> = { version: p.version, harnesses: p.harnesses, skills: p.skills };
    if (p.scope !== undefined) out.scope = p.scope;
    out.agents = agents;
    for (const [k, v] of Object.entries(rawPack)) if (!PACK_KNOWN.has(k)) out[k] = v;
    packs[key] = out;
  }
  const doc: Record<string, unknown> = { $schema: `${SCHEMA_BASE}/config.json`, packs };
  for (const [k, v] of Object.entries(config.raw)) if (k !== "$schema" && k !== "packs") doc[k] = v;
  return toJsonText(doc);
}

/** The bindings of one pack for the given agents; missing entries are `generate` (R-CFG-3). */
export function packBindings(pack: PackConfig, agents: readonly string[], harnesses: readonly Harness[] = pack.harnesses): Bindings {
  const overrides: BindingOverrides = {};
  for (const a of agents) {
    for (const h of harnesses) {
      const text = pack.agents[a]?.[h];
      (overrides[a] ??= {})[h] = text === undefined ? GENERATE : parseBinding(text);
    }
  }
  return resolveBindings(agents, harnesses, overrides);
}
