import { HARNESS_INFO, type Harness } from "./harness.js";
import { NAME_PATTERN, scopedName } from "./names.js";

/** How a pack agent is filled in one harness (R-CFG-1). Same strings as skillpack.json. */
export type Binding = { kind: "generate" } | { kind: "existing"; id: string } | { kind: "none" };

export class BindingError extends Error {}

export const GENERATE: Binding = { kind: "generate" };

export function parseBinding(text: string): Binding {
  if (text === "generate") return GENERATE;
  if (text === "none") return { kind: "none" };
  const m = /^existing:(.+)$/.exec(text);
  if (m && NAME_PATTERN.test(m[1]!)) return { kind: "existing", id: m[1]! };
  throw new BindingError(`invalid binding "${text}"; use generate, none or existing:<id>`);
}

export function formatBinding(b: Binding): string {
  return b.kind === "existing" ? `existing:${b.id}` : b.kind;
}

/** Throws unless an `existing:` binding names a built-in agent of that harness. */
export function checkBuiltin(harness: Harness, b: Binding): void {
  if (b.kind !== "existing") return;
  const info = HARNESS_INFO[harness];
  if (!info.builtinAgents.includes(b.id)) {
    throw new BindingError(
      `"${b.id}" is not a built-in ${info.displayName} agent (allowed: ${info.builtinAgents.join(", ")})`,
    );
  }
}

/** The installed agent ID, or null when the agent is bound to none. */
export function agentIdFor(scope: string, agentName: string, b: Binding): string | null {
  return b.kind === "generate" ? scopedName(scope, agentName) : b.kind === "existing" ? b.id : null;
}

export type BindingOverrides = Record<string, Partial<Record<Harness, Binding>>>;
/** agent -> harness -> binding, for the selected harnesses. */
export type Bindings = Record<string, Partial<Record<Harness, Binding>>>;

export const bindingOf = (bindings: Bindings, agent: string, harness: Harness): Binding =>
  bindings[agent]?.[harness] ?? GENERATE;

/** Fills every agent × harness; missing entries are `generate` (R-CFG-3). */
export function resolveBindings(
  agents: readonly string[],
  harnesses: readonly Harness[],
  overrides: BindingOverrides = {},
): Bindings {
  const out: Bindings = {};
  for (const a of agents) {
    out[a] = {};
    for (const h of harnesses) out[a]![h] = overrides[a]?.[h] ?? GENERATE;
  }
  return out;
}

export interface ParsedBind {
  agent: string;
  harness?: Harness;
  binding: Binding;
}

/** Parses `<agent>[.<harness>]=<binding>`. */
export function parseBindFlag(spec: string, harnessNames: readonly string[]): ParsedBind {
  const eq = spec.indexOf("=");
  if (eq <= 0) throw new BindingError(`invalid --bind "${spec}"; use <agent>[.<harness>]=<binding>`);
  const [agent, harness, ...extra] = spec.slice(0, eq).split(".");
  if (!agent || extra.length > 0) throw new BindingError(`invalid --bind "${spec}"; use <agent>[.<harness>]=<binding>`);
  if (harness !== undefined && !harnessNames.includes(harness)) {
    throw new BindingError(`unknown harness "${harness}" in --bind "${spec}"`);
  }
  const binding = parseBinding(spec.slice(eq + 1));
  return harness === undefined ? { agent, binding } : { agent, harness: harness as Harness, binding };
}

/**
 * Builds the bindings from `--agent` and `--bind` (R-CFG-12): `--agent a,b` binds every other
 * agent to none, `none` binds all of them, `*` leaves the defaults; `--bind` applies afterwards.
 */
export function bindingsFromOptions(o: {
  agents: readonly string[];
  harnesses: readonly Harness[];
  agentOption?: string | undefined;
  binds?: readonly string[] | undefined;
}): Bindings {
  const overrides: BindingOverrides = {};
  const set = (agent: string, harness: Harness, b: Binding): void => {
    (overrides[agent] ??= {})[harness] = b;
  };
  const none: Binding = { kind: "none" };
  const opt = o.agentOption?.trim();
  if (opt !== undefined && opt !== "*") {
    const keep = opt === "none" ? [] : opt.split(",").map((s) => s.trim()).filter(Boolean);
    for (const k of keep) {
      if (!o.agents.includes(k)) throw new BindingError(`--agent: the pack has no agent "${k}"`);
    }
    for (const a of o.agents) if (!keep.includes(a)) for (const h of o.harnesses) set(a, h, none);
  }
  for (const spec of o.binds ?? []) {
    const p = parseBindFlag(spec, o.harnesses);
    if (!o.agents.includes(p.agent)) throw new BindingError(`--bind: the pack has no agent "${p.agent}"`);
    if (p.harness !== undefined && !o.harnesses.includes(p.harness)) {
      throw new BindingError(`--bind: harness "${p.harness}" is not selected`);
    }
    for (const h of p.harness ? [p.harness] : o.harnesses) {
      checkBuiltin(h, p.binding);
      set(p.agent, h, p.binding);
    }
  }
  return resolveBindings(o.agents, o.harnesses, overrides);
}
