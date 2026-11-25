import { GENERATE, formatBinding, type Binding, type Bindings } from "../bindings.js";
import { HARNESS_INFO, type Harness } from "../harness.js";
import type { Prompts } from "./index.js";

export interface AgentInfo {
  name: string;
  description: string;
  fallback: string;
}

const same = (a: Binding, b: Binding): boolean => formatBinding(a) === formatBinding(b);
const parse = (text: string): Binding =>
  text === "generate" ? GENERATE : text === "none" ? { kind: "none" } : { kind: "existing", id: text.slice("existing:".length) };

/**
 * R-CFG-1: asks how each agent is filled in each harness: generate the pack's agent, use a built-in
 * agent of the harness, or none (skills then say the agent's fallback text). With several harnesses
 * the first question offers the answers that work everywhere (generate, none) so one answer covers
 * them all; "choose per harness" asks the long form. The default is the current binding (generate
 * for new agents). Returns bindings for exactly the given agents and harnesses.
 */
export async function promptBindings(o: {
  agents: readonly AgentInfo[];
  harnesses: readonly Harness[];
  current: Bindings;
  prompts: Prompts;
}): Promise<Bindings> {
  const out: Bindings = {};
  const now = (a: string, h: Harness): Binding => o.current[a]?.[h] ?? GENERATE;

  for (const agent of o.agents) {
    out[agent.name] = {};
    const heading = `${agent.name}: ${agent.description}`;
    const fallbackHint = `skills will say: ${agent.fallback}`;

    const perHarness = async (h: Harness): Promise<Binding> => {
      const info = HARNESS_INFO[h];
      const cur = now(agent.name, h);
      const choice = await o.prompts.select<string>({
        message: `${agent.name} in ${info.displayName}`,
        initial: formatBinding(cur),
        options: [
          { value: "generate", label: "Generate the pack's agent" },
          ...info.builtinAgents.map((id) => ({ value: `existing:${id}`, label: `Use built-in "${id}"` })),
          { value: "none", label: "None", hint: fallbackHint },
        ],
      });
      return parse(choice);
    };

    if (o.harnesses.length === 1) {
      out[agent.name]![o.harnesses[0]!] = await perHarness(o.harnesses[0]!);
      continue;
    }

    const cur = o.harnesses.map((h) => now(agent.name, h));
    const allSame = cur.every((b) => same(b, cur[0]!)) && (cur[0]!.kind === "generate" || cur[0]!.kind === "none");
    const first = await o.prompts.select<string>({
      message: heading,
      initial: allSame ? formatBinding(cur[0]!) : "per-harness",
      options: [
        { value: "generate", label: "Generate the pack's agent in every harness" },
        { value: "none", label: "None in every harness", hint: fallbackHint },
        { value: "per-harness", label: "Choose per harness (built-in agents differ per harness)" },
      ],
    });
    if (first === "per-harness") for (const h of o.harnesses) out[agent.name]![h] = await perHarness(h);
    else for (const h of o.harnesses) out[agent.name]![h] = parse(first);
  }
  return out;
}
