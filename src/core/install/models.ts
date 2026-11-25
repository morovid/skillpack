import { bindingOf } from "../bindings.js";
import type { AgentWarning } from "../agents/index.js";
import type { Harness } from "../harness.js";
import type { ModelSource } from "../models/available.js";
import { requestKey, resolveModels, type ModelRequest } from "../models/resolve.js";
import type { Prompts } from "../prompts/index.js";
import { emptyModels, packBindings, readModels, serializeModels, setModel } from "../project/index.js";
import { InstallError } from "./select.js";
import type { PackTarget } from "./project.js";

export interface MappingChange {
  key: string;
  name: string;
  harness: Harness;
  from: string | null;
  to: string;
}

export interface ModelSet {
  key: string;
  name: string;
  harness: Harness;
  concrete: string;
}

/** The model requests of a target: every agent bound to generate, in a harness this run generates files for, that asks for a model. */
export function modelRequests(t: PackTarget): ModelRequest[] {
  const bindings = packBindings(t.packConfig, t.pack.agents.map((a) => a.name), t.packConfig.harnesses);
  const out: ModelRequest[] = [];
  for (const a of t.pack.agents) {
    if (a.modelNames.length === 0) continue;
    for (const h of t.agentHarnesses) {
      if (bindingOf(bindings, a.name, h).kind === "generate") out.push({ agent: a.name, harness: h, names: a.modelNames, ...(a.effort ? { effort: a.effort } : {}) });
    }
  }
  return out;
}

/**
 * Matches the models of every target (R-REQ-3), fills each target's `modelFor` and `modelWarnings`,
 * and returns the new models file text when mappings changed. `set` first sets mappings the user
 * gave (`configure --model`). Never called for `install --frozen-lockfile`, which doesn't match
 * models or write the models file (R-VER-6). With `strict`, problems come back in `failures`.
 */
export async function resolveTargetModels(o: {
  projectDir: string;
  targets: PackTarget[];
  source: ModelSource;
  prompts?: Prompts | undefined;
  strict?: boolean;
  set?: readonly ModelSet[];
}): Promise<{ models?: { text: string }; changed: boolean; failures: string[]; mappingChanges: MappingChange[] }> {
  const state = readModels(o.projectDir);
  if (state.status === "invalid") throw new InstallError(state.errors.join("\n"));
  const before = state.status === "ok" ? state.value : emptyModels();
  let models = structuredClone(before);
  let changed = false;
  for (const s of o.set ?? []) {
    if (models.packs[s.key]?.[s.name]?.[s.harness] !== s.concrete) changed = true;
    setModel(models, s.key, s.name, s.harness, s.concrete);
  }
  const failures: string[] = [];

  for (const t of o.targets) {
    const requests = modelRequests(t);
    if (requests.length === 0) {
      t.modelFor = () => undefined;
      t.modelWarnings = [];
      continue;
    }
    const r = await resolveModels({ packKey: t.key, requests, models, source: o.source, prompts: o.prompts, ...(o.strict ? { strict: true } : {}) });
    models = r.models;
    changed ||= r.changed;
    failures.push(...r.failures.map((f) => `${t.key}: ${f}`));
    t.modelFor = (agent, harness) => r.concrete.get(requestKey(agent, harness));
    t.modelWarnings = r.warnings.map((w): AgentWarning => ({ agent: w.agent, harness: w.harness, kind: "model", message: w.message }));
  }
  const mappingChanges: MappingChange[] = [];
  for (const [key, names] of Object.entries(models.packs)) {
    for (const [name, per] of Object.entries(names)) {
      for (const [h, to] of Object.entries(per)) {
        const from = before.packs[key]?.[name]?.[h as Harness] ?? null;
        if (from !== to) mappingChanges.push({ key, name, harness: h as Harness, from, to: to! });
      }
    }
  }
  return { changed, failures, mappingChanges, ...(changed ? { models: { text: serializeModels(models) } } : {}) };
}
