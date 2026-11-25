import type { Harness } from "../harness.js";
import { HARNESS_INFO } from "../harness.js";
import type { Prompts } from "../prompts/index.js";
import { getModel, setModel, type Models } from "../project/models.js";
import type { AvailableModel, ModelList, ModelSource } from "./available.js";
import { mapEffort } from "./effort.js";
import { findMatch } from "./match.js";

/** One generated agent × harness that asks for a model. */
export interface ModelRequest {
  agent: string;
  harness: Harness;
  /** The harness-neutral names in order of preference. */
  names: string[];
  effort?: string;
}

export interface ModelWarning {
  agent: string;
  harness: Harness;
  message: string;
}

export interface ResolveModelsResult {
  /** `${agent}\0${harness}` -> the concrete model (OpenCode: with `#variant`). Missing = generate without a model. */
  concrete: Map<string, string>;
  warnings: ModelWarning[];
  /** The models file content after this run. */
  models: Models;
  changed: boolean;
  /** Only with `strict`: problems that must fail the command. */
  failures: string[];
}

export const requestKey = (agent: string, harness: Harness): string => `${agent}\0${harness}`;

const PATTERN: Record<Harness, RegExp> = { opencode: /^[^/\s#]+\/[^\s#]+$/, codex: /^[^\s]+$/ };
const NO_MODEL = "it will use the parent session's model, which can cost more";

/**
 * R-REQ-2..5: turns each request into a concrete model. An existing mapping in the models file is
 * used as is (a warning if the model is no longer listed). Otherwise the names are matched against
 * the harness's list, in the agent's order: one match is used; several ask (when `prompts` is
 * given) or pick the first by name with a warning; none asks (pick, type, or skip) or generates the
 * agent without a model. When Codex's list can't be read (unverified) the first requested name is
 * accepted as given. New mappings are returned in `models`.
 */
export async function resolveModels(o: {
  packKey: string;
  requests: readonly ModelRequest[];
  models: Models;
  source: ModelSource;
  prompts?: Prompts | undefined;
  strict?: boolean;
}): Promise<ResolveModelsResult> {
  const models = structuredClone(o.models);
  const result: ResolveModelsResult = { concrete: new Map(), warnings: [], models, changed: false, failures: [] };
  const seen = new Set<string>();
  const warn = (r: ModelRequest, message: string, dedupe = `${r.harness}|${message}`): void => {
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    result.warnings.push({ agent: r.agent, harness: r.harness, message });
  };
  const decided = new Map<string, { model?: string; info?: AvailableModel | undefined }>();
  const lists = new Map<Harness, ModelList>();
  const listOf = async (h: Harness): Promise<ModelList> => lists.get(h) ?? lists.set(h, await o.source.list(h)).get(h)!;
  const display = (h: Harness): string => HARNESS_INFO[h].displayName;

  for (const r of o.requests) {
    const list = await listOf(r.harness);
    const names = r.names.join("|");
    const cacheKey = `${r.harness}|${names}`;
    let d = decided.get(cacheKey);

    if (!d) {
      d = {};
      decided.set(cacheKey, d);
      const mapped = r.names.find((n) => getModel(models, o.packKey, n, r.harness) !== undefined);
      if (mapped !== undefined) {
        d.model = getModel(models, o.packKey, mapped, r.harness)!;
        if (list.status === "ok") {
          const mappedModel = d.model;
          d.info = list.models.find((m) => m.name === mappedModel);
          if (!d.info) warn(r, `the mapped model "${d.model}" for "${mapped}" is no longer listed by ${display(r.harness)}; keeping it`);
        }
      } else if (list.status === "unavailable") {
        warn(r, `${display(r.harness)}'s model list isn't available (${list.reason}); agents are generated without a model: ${NO_MODEL}`);
        if (o.strict) result.failures.push(`${display(r.harness)}'s model list isn't available (${list.reason}), so models can't be matched`);
      } else {
        const save = (name: string, model: string): void => {
          setModel(models, o.packKey, name, r.harness, model);
          result.changed = true;
          d!.model = model;
        };
        const match = list.status === "ok" ? findMatch(r.names, list.models) : null;
        if (list.status === "unverified") {
          save(r.names[0]!, r.names[0]!);
          warn(r, `${display(r.harness)} models can't be verified (${list.reason}); using "${r.names[0]}" as given`);
        } else if (match && match.candidates.length === 1) {
          d.info = match.candidates[0]!;
          save(match.name, d.info.name);
        } else if (match) {
          const names = match.candidates.map((c) => c.name);
          let pick = names[0]!;
          if (o.prompts) {
            pick = await o.prompts.select<string>({
              message: `Which model for "${match.name}" in ${display(r.harness)}?`,
              options: names.map((n) => ({ value: n, label: n })),
              initial: pick,
            });
          } else warn(r, `"${match.name}" matches several ${display(r.harness)} models (${names.join(", ")}); using ${pick}`);
          d.info = match.candidates.find((c) => c.name === pick);
          save(match.name, pick);
        } else if (list.status === "ok") {
          const skip = "\0skip";
          const type = "\0type";
          const choice = o.prompts && !o.strict
            ? await o.prompts.select<string>({
                message: `No ${display(r.harness)} model matches ${r.names.map((n) => `"${n}"`).join(" or ")} (asked by ${r.agent}). Which one should it use?`,
                options: [
                  { value: skip, label: "Skip: generate without a model", hint: NO_MODEL },
                  { value: type, label: "Type a model name…" },
                  ...list.models.map((m) => ({ value: m.name, label: m.name })),
                ],
                initial: skip,
              })
            : skip;
          if (choice === type) {
            const typed = await o.prompts!.text({
              message: `Model for "${r.names[0]}" in ${display(r.harness)}`,
              placeholder: r.harness === "opencode" ? "provider/model" : "model",
              validate: (v) => (PATTERN[r.harness].test(v.trim()) ? undefined : r.harness === "opencode" ? "use provider/model" : "enter a model name"),
            });
            save(r.names[0]!, typed.trim());
            d.info = list.models.find((m) => m.name === d!.model);
          } else if (choice !== skip) {
            d.info = list.models.find((m) => m.name === choice);
            save(r.names[0]!, choice);
          } else {
            warn(r, `no ${display(r.harness)} model matches ${r.names.map((n) => `"${n}"`).join(" or ")} (asked by ${r.agent}); generated without a model: ${NO_MODEL}`, `${cacheKey}|nomatch`);
            if (o.strict) result.failures.push(`${r.agent}: no ${display(r.harness)} model matches ${r.names.map((n) => `"${n}"`).join(" or ")}`);
          }
        }
      }
    }

    if (d.model === undefined) continue;
    const eff = mapEffort(r.harness, r.effort, { variants: null, efforts: d.info?.efforts ?? null });
    if (eff.warning) warn(r, eff.warning, `${r.harness}|effort|${r.effort}|${eff.warning}`);
    result.concrete.set(requestKey(r.agent, r.harness), eff.variant && r.harness === "opencode" ? `${d.model}#${eff.variant}` : d.model);
  }
  return result;
}
