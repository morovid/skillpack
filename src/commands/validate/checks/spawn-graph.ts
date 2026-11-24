import { agentRel } from "../../../core/pack/index.js";
import { AGENT_MANIFEST_FILE } from "../../../core/paths.js";
import type { CheckContext } from "../context.js";
import type { AgentGraphNode } from "./agents.js";

export function checkSpawnGraph(ctx: CheckContext, graph: Map<string, AgentGraphNode>): void {
  const fileOf = (n: string): string => agentRel(n, AGENT_MANIFEST_FILE);

  // Edges that are valid to follow: existing targets, no self-spawn.
  const edges = new Map<string, string[]>();
  for (const [name, node] of graph) {
    const out: string[] = [];
    for (const t of node.spawn) {
      if (t === name) {
        ctx.diag.error("spawn-self", `agent "${name}" lists itself in spawn`, { file: fileOf(name) });
      } else if (!ctx.agentNames.has(t)) {
        ctx.diag.error("spawn-unknown", `spawn target "${t}" is not an agent in src/agents/`, { file: fileOf(name) });
      } else {
        out.push(t);
      }
    }
    edges.set(name, out);
  }

  // Cycle detection (DFS), reporting each cycle once.
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): void => {
    state.set(n, 1);
    stack.push(n);
    for (const t of edges.get(n) ?? []) {
      if (state.get(t) === 1) {
        const path = [...stack.slice(stack.indexOf(t)), t];
        ctx.diag.error("spawn-cycle", `spawn cycle: ${path.join(" -> ")}`, { file: fileOf(t) });
      } else if (!state.has(t)) visit(t);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of edges.keys()) if (!state.has(n)) visit(n);
}
