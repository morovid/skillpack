import type { AvailableModel, ModelList, ModelSource } from "../../src/core/models/available.js";
import type { Harness } from "../../src/core/harness.js";

type Spec = (string | AvailableModel)[] | "unavailable" | "unverified";

const toList = (spec: Spec, harness: Harness): ModelList => {
  if (spec === "unavailable" || spec === "unverified") return { status: spec, reason: `${harness} is not installed (test)` };
  return { status: "ok", models: spec.map((m) => (typeof m === "string" ? { name: m, ...(m.includes("/") ? { provider: m.split("/")[0]! } : {}) } : m)) };
};

/** A ModelSource for tests; counts how often each harness is asked. */
export function fakeModels(spec: { opencode?: Spec; codex?: Spec } = {}): ModelSource & { calls: Harness[] } {
  const calls: Harness[] = [];
  return {
    calls,
    async list(h) {
      calls.push(h);
      return toList(spec[h] ?? (h === "opencode" ? "unavailable" : "unverified"), h);
    },
  };
}

/** The default for tests that don't care about models: OpenCode's list is unavailable, Codex is unverified. */
export const noModels = (): ModelSource => fakeModels();
