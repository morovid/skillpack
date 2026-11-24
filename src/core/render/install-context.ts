import { agentIdFor, bindingOf, type Bindings } from "../bindings.js";
import { HARNESS_INFO, type Harness } from "../harness.js";
import { scopedName } from "../names.js";
import type { RenderContext } from "./types.js";

/**
 * The text that replaces `{{agent:x}}` in shared skills (R-CFG-7): the first harness's part, then
 * a parenthetical for the other harnesses whose part differs. A part is the backticked ID, or the
 * fallback text (not backticked) when the agent is bound to none there.
 */
export function agentPhrase(o: {
  scope: string;
  agent: string;
  fallback: string;
  harnesses: readonly Harness[];
  bindings: Bindings;
}): string {
  const parts = o.harnesses.map((h) => {
    const id = agentIdFor(o.scope, o.agent, bindingOf(o.bindings, o.agent, h));
    return { harness: h, text: id === null ? o.fallback : `\`${id}\`` };
  });
  const first = parts[0];
  if (!first) return o.fallback;
  const others = parts.slice(1).filter((p) => p.text !== first.text);
  if (others.length === 0) return first.text;
  return `${first.text} (${others.map((p) => `${HARNESS_INFO[p.harness].displayName}: ${p.text}`).join(", ")})`;
}

/** Install mode: prefixed skill names, agent phrases from the bindings. */
export function createInstallContext(o: {
  scope: string;
  skillNames: Iterable<string>;
  agents: ReadonlyMap<string, { fallback: string }>;
  harnesses: readonly Harness[];
  bindings: Bindings;
}): RenderContext {
  const folder = (n: string): string => scopedName(o.scope, n);
  return {
    mode: "install",
    scope: o.scope,
    skillNames: new Set(o.skillNames),
    skillFolderName: folder,
    resolver: {
      scope: o.scope,
      skill: folder,
      agent(name) {
        const a = o.agents.get(name);
        if (!a) throw new Error(`unknown agent "${name}"`);
        return agentPhrase({ scope: o.scope, agent: name, fallback: a.fallback, harnesses: o.harnesses, bindings: o.bindings });
      },
    },
  };
}
