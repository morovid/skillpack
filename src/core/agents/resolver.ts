import { GENERATE, agentIdFor, type Binding } from "../bindings.js";
import { scopedName } from "../names.js";
import type { PlaceholderResolver } from "../placeholders.js";
import type { AgentSpec } from "./types.js";

/** Placeholders in a generated agent resolve for ONE harness (R-PH-6): no harness-qualified phrases. */
export function agentResolver(
  scope: string,
  agents: ReadonlyMap<string, AgentSpec>,
  bindings: Record<string, Binding>,
): PlaceholderResolver {
  return {
    scope,
    skill: (n) => scopedName(scope, n),
    agent(name) {
      const spec = agents.get(name);
      if (!spec) throw new Error(`unknown agent "${name}"`);
      const id = agentIdFor(scope, name, bindings[name] ?? GENERATE);
      return id === null ? spec.fallback : `\`${id}\``;
    },
  };
}

/** IDs of the agents `spec` may start that exist in this harness (bound to none are left out). */
export function spawnIds(scope: string, spec: AgentSpec, bindings: Record<string, Binding>): string[] {
  return spec.spawn
    .map((n) => agentIdFor(scope, n, bindings[n] ?? GENERATE))
    .filter((id): id is string => id !== null);
}
