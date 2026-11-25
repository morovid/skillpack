import { HARNESS_INFO, type Harness } from "../harness.js";
import type { ModelSource } from "../models/available.js";
import { getModel, type Models } from "../project/models.js";
import type { ModelRequest } from "../models/resolve.js";
import type { Prompts } from "./index.js";

export interface ModelChoice {
  name: string;
  harness: Harness;
  concrete: string;
}

const PATTERN: Record<Harness, RegExp> = { opencode: /^[^/\s#]+\/[^\s#]+$/, codex: /^[^\s]+$/ };

/**
 * `configure --models` (R-REQ-2): for each model name the pack asks for, in each harness, shows the
 * current mapping and lets the user keep it, pick an available model, or type one.
 */
export async function promptModelMappings(o: {
  packKey: string;
  requests: readonly ModelRequest[];
  models: Models;
  source: ModelSource;
  prompts: Prompts;
}): Promise<ModelChoice[]> {
  const out: ModelChoice[] = [];
  const done = new Set<string>();
  for (const r of o.requests) {
    const name = r.names.find((n) => getModel(o.models, o.packKey, n, r.harness) !== undefined) ?? r.names[0]!;
    if (done.has(`${name}|${r.harness}`)) continue;
    done.add(`${name}|${r.harness}`);
    const current = getModel(o.models, o.packKey, name, r.harness);
    const list = await o.source.list(r.harness);
    const keep = "\0keep";
    const type = "\0type";
    const choice = await o.prompts.select<string>({
      message: `Model for "${name}" in ${HARNESS_INFO[r.harness].displayName}${current ? ` (now ${current})` : " (not mapped yet)"}`,
      initial: current ? keep : type,
      options: [
        ...(current ? [{ value: keep, label: `Keep ${current}` }] : []),
        ...(list.status === "ok" ? list.models.map((m) => ({ value: m.name, label: m.name })) : []),
        { value: type, label: "Type a model name…", ...(list.status !== "ok" ? { hint: "the model list isn't available" } : {}) },
      ],
    });
    if (choice === keep) continue;
    const concrete =
      choice === type
        ? (await o.prompts.text({ message: `Model for "${name}"`, placeholder: r.harness === "opencode" ? "provider/model" : "model", validate: (v) => (PATTERN[r.harness].test(v.trim()) ? undefined : "not a valid model name") })).trim()
        : choice;
    if (concrete !== current) out.push({ name, harness: r.harness, concrete });
  }
  return out;
}
