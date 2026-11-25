import type { Harness } from "../harness.js";
import type { ModelSource } from "../models/available.js";
import { findMatch } from "../models/match.js";
import type { ModelRequest } from "../models/resolve.js";
import { getModel, type Models } from "../project/models.js";

export type ModelStatus = "mapped" | "available" | "unavailable" | "unverified" | "not mapped";

export interface ModelRow {
  name: string;
  harness: Harness;
  mapped: string | null;
  status: ModelStatus;
}

/**
 * `configure --show`: one row per model name a generated agent asks for, per harness. mapped: it is
 * in the models file and the harness lists it; unavailable: mapped but no longer listed;
 * unverified: mapped but the list can't be read; available: not mapped yet, but the next run would
 * match it; not mapped: no mapping and nothing to match. With `requests` null (the pack wasn't
 * fetched) only the mappings in the models file are listed.
 */
export async function describeModels(o: {
  packKey: string;
  requests: readonly ModelRequest[] | null;
  models: Models;
  source: ModelSource;
}): Promise<ModelRow[]> {
  const rows = new Map<string, ModelRow>();
  const add = (r: ModelRow): void => void rows.set(`${r.name}\0${r.harness}`, r);
  const statusOf = async (names: readonly string[], harness: Harness, name: string): Promise<ModelRow> => {
    const mapped = getModel(o.models, o.packKey, name, harness) ?? null;
    const list = await o.source.list(harness);
    if (mapped !== null) {
      return { name, harness, mapped, status: list.status !== "ok" ? "unverified" : list.models.some((m) => m.name === mapped) ? "mapped" : "unavailable" };
    }
    return { name, harness, mapped: null, status: list.status === "ok" && findMatch(names, list.models) ? "available" : "not mapped" };
  };

  if (o.requests) {
    for (const r of o.requests) {
      const hit = r.names.find((n) => getModel(o.models, o.packKey, n, r.harness) !== undefined) ?? r.names[0]!;
      add(await statusOf(r.names, r.harness, hit));
    }
  } else {
    for (const [name, per] of Object.entries(o.models.packs[o.packKey] ?? {})) {
      for (const harness of Object.keys(per) as Harness[]) add(await statusOf([name], harness, name));
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.harness.localeCompare(b.harness));
}

export function formatModelRows(rows: readonly ModelRow[], displayName: (h: Harness) => string): string {
  if (rows.length === 0) return "  models: none requested by the generated agents\n";
  const head = ["model", "harness", "mapped to", "status"];
  const body = rows.map((r) => [r.name, displayName(r.harness), r.mapped ?? "-", r.status]);
  const w = head.map((_, i) => Math.max(...[head, ...body].map((r) => r[i]!.length)));
  return [head, ...body].map((r) => `  ${r.map((c, j) => c.padEnd(w[j]!)).join("  ").trimEnd()}\n`).join("");
}
