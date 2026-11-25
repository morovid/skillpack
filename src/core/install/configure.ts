import { BindingError, GENERATE, checkBuiltin, formatBinding, parseBindFlag, type Bindings } from "../bindings.js";
import { HARNESSES, HARNESS_INFO, type Harness } from "../harness.js";
import { toKebab } from "../names.js";
import { promptBindings } from "../prompts/bindings.js";
import type { Prompts } from "../prompts/index.js";
import { packBindings, type PackConfig } from "../project/index.js";
import type { LoadedPack } from "./fetch-pack.js";
import { InstallError } from "./select.js";

export interface BindingChange {
  agent: string;
  harness: Harness;
  /** The explicit binding before, or null when skillpack.json had none (an implicit generate). */
  from: string | null;
  to: string;
}

export const formatBindingChange = (c: BindingChange): string =>
  `${c.agent} (${HARNESS_INFO[c.harness].displayName}): ${c.from ?? "(not set)"} → ${c.to}`;

/** Resolves agent names a user typed (plain, kebab or `<scope>-<name>`) against the pack's agents. */
export function resolveAgentRefs(refs: readonly string[], agents: readonly string[], scope: string): string[] {
  return [
    ...new Set(
      refs.map((r) => {
        const hit = agents.find((a) => a === r || toKebab(a) === toKebab(r) || `${toKebab(scope)}-${toKebab(a)}` === toKebab(r));
        if (!hit) throw new InstallError(`the pack has no agent "${r}" (agents: ${agents.join(", ")})`, true);
        return hit;
      }),
    ),
  ];
};

export type ConfigureMode =
  | { kind: "binds"; specs: readonly string[] }
  /** Ask for each chosen agent × harness. */
  | { kind: "prompt"; prompts: Prompts }
  /** Change nothing; only make every binding explicit (R-CFG-2). */
  | { kind: "defaults" };

/**
 * Computes the pack's new entry for skillpack.json (R-CFG-1..3, R-CFG-12): every agent of the pack
 * × harness gets an explicit binding, the chosen ones changed by `--bind` or by prompts. Entries
 * for agents the pack no longer has are kept (R-CFG-9).
 */
export async function computePackConfig(o: {
  pack: LoadedPack;
  cfg: PackConfig;
  scope: string;
  agentRefs: readonly string[];
  harnessFlag: readonly Harness[];
  mode: ConfigureMode;
}): Promise<{ packConfig: PackConfig; changes: BindingChange[] }> {
  const agentNames = o.pack.agents.map((a) => a.name);
  const chosenAgents = o.agentRefs.length > 0 ? resolveAgentRefs(o.agentRefs, agentNames, o.scope) : agentNames;
  for (const h of o.harnessFlag) {
    if (!o.cfg.harnesses.includes(h)) throw new InstallError(`-a ${h}: the pack isn't installed for ${h} (harnesses: ${o.cfg.harnesses.join(", ")})`, true);
  }
  const chosenHarnesses = o.harnessFlag.length > 0 ? HARNESSES.filter((h) => o.harnessFlag.includes(h)) : o.cfg.harnesses;

  const current: Bindings = packBindings(o.cfg, agentNames, o.cfg.harnesses);
  const next: Bindings = structuredClone(current);

  if (o.mode.kind === "binds") {
    for (const spec of o.mode.specs) {
      try {
        const b = parseBindFlag(spec, HARNESSES);
        const [agent] = resolveAgentRefs([b.agent], agentNames, o.scope);
        if (b.harness && !chosenHarnesses.includes(b.harness)) {
          throw new InstallError(`--bind ${spec}: ${b.harness} isn't one of the selected harnesses (${chosenHarnesses.join(", ")})`, true);
        }
        for (const h of b.harness ? [b.harness] : chosenHarnesses) {
          checkBuiltin(h, b.binding);
          next[agent!]![h] = b.binding;
        }
      } catch (e) {
        if (e instanceof BindingError) throw new InstallError(e.message, true);
        throw e;
      }
    }
  } else if (o.mode.kind === "prompt") {
    const asked = await promptBindings({
      agents: o.pack.agents.filter((a) => chosenAgents.includes(a.name)),
      harnesses: chosenHarnesses,
      current,
      prompts: o.mode.prompts,
    });
    for (const [agent, per] of Object.entries(asked)) for (const [h, b] of Object.entries(per)) next[agent]![h as Harness] = b!;
  }

  const agents: PackConfig["agents"] = structuredClone(o.cfg.agents);
  const changes: BindingChange[] = [];
  for (const a of agentNames) {
    const entry = { ...(agents[a] ?? {}) };
    for (const h of o.cfg.harnesses) {
      const to = formatBinding(next[a]?.[h] ?? GENERATE);
      const from = o.cfg.agents[a]?.[h] ?? null;
      if (from !== to) changes.push({ agent: a, harness: h, from, to });
      entry[h] = to;
    }
    agents[a] = entry;
  }
  return { packConfig: { ...o.cfg, agents }, changes };
}

/** Warnings `configure --show` can find offline: bindings to agents that aren't built in. */
export function bindingWarnings(cfg: PackConfig): string[] {
  const out: string[] = [];
  for (const [agent, per] of Object.entries(cfg.agents)) {
    for (const h of cfg.harnesses) {
      const b = per[h];
      if (b?.startsWith("existing:")) {
        const id = b.slice("existing:".length);
        if (!HARNESS_INFO[h].builtinAgents.includes(id)) {
          out.push(`${agent} (${HARNESS_INFO[h].displayName}): "${id}" is not a built-in ${HARNESS_INFO[h].displayName} agent (${HARNESS_INFO[h].builtinAgents.join(", ")})`);
        }
      }
    }
  }
  return out;
}
