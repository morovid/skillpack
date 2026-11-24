import { join } from "node:path";
import { HARNESSES, type Harness } from "../harness.js";
import { MODELS_FILE, SCHEMA_BASE } from "./paths.js";
import { readValidated, sortedEntries, toJsonText, type FileState } from "./io.js";

/** pack source -> model name -> harness -> concrete model */
export interface Models {
  packs: Record<string, Record<string, Partial<Record<Harness, string>>>>;
}

export const emptyModels = (): Models => ({ packs: {} });

export function readModels(projectDir: string): FileState<Models> {
  return readValidated(join(projectDir, MODELS_FILE), MODELS_FILE, "models", false, (doc) => doc as unknown as Models);
}

export const getModel = (m: Models, pack: string, modelName: string, harness: Harness): string | undefined =>
  m.packs[pack]?.[modelName]?.[harness];

export function setModel(m: Models, pack: string, modelName: string, harness: Harness, concrete: string): Models {
  ((m.packs[pack] ??= {})[modelName] ??= {})[harness] = concrete;
  return m;
}

/** Drops all mappings of a pack (used by `remove`). */
export function removePackModels(m: Models, pack: string): Models {
  delete m.packs[pack];
  return m;
}

export function serializeModels(m: Models): string {
  const packs: Record<string, unknown> = {};
  for (const [pack, names] of sortedEntries(m.packs)) {
    const out: Record<string, unknown> = {};
    for (const [name, per] of sortedEntries(names)) {
      const entry: Record<string, string> = {};
      for (const h of HARNESSES) if (per[h] !== undefined) entry[h] = per[h]!;
      out[name] = entry;
    }
    packs[pack] = out;
  }
  return toJsonText({ $schema: `${SCHEMA_BASE}/models.json`, packs });
}
