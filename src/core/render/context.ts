import { scopedName, toKebab } from "../names.js";
import type { RenderContext } from "./types.js";

/** Plain build (`npx skills` layout): kebab names, no prefix, agents replaced by their fallback text. */
export function createPlainContext(opts: {
  scope: string;
  skillNames: Iterable<string>;
  /** Agent source name -> fallback text. */
  fallbacks: ReadonlyMap<string, string>;
}): RenderContext {
  return {
    mode: "plain",
    scope: opts.scope,
    skillNames: new Set(opts.skillNames),
    skillFolderName: toKebab,
    resolver: {
      scope: opts.scope,
      skill: toKebab,
      agent(name) {
        const f = opts.fallbacks.get(name);
        if (f === undefined) throw new Error(`unknown agent "${name}"`);
        return f;
      },
    },
  };
}

export const installFolderName = scopedName;
