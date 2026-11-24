import { readJsonFile } from "../pack/json.js";
import { formatPointer, schemaVersion, validateAgainst, type SchemaName } from "../schema/index.js";

export type FileState<T> =
  | { status: "missing" }
  | { status: "invalid"; errors: string[] }
  | { status: "ok"; value: T; /** JSON pointers of keys the schema doesn't know (kept, R-CFG-9). */ unknownKeys: string[] };

/**
 * Reads and validates a project JSON file. With `tolerateUnknown`, "unexpected property" issues
 * don't make the file invalid; they are returned as `unknownKeys`.
 */
export function readValidated<T>(
  path: string,
  file: string,
  schema: SchemaName,
  tolerateUnknown: boolean,
  build: (doc: Record<string, unknown>) => T,
): FileState<T> {
  const r = readJsonFile(path);
  if (!r.ok) return r.reason === "missing" ? { status: "missing" } : { status: "invalid", errors: [`${file}: ${r.message}`] };
  const v = schemaVersion(r.value, file);
  if ("error" in v) return { status: "invalid", errors: [v.error] };
  const errors: string[] = [];
  const unknownKeys: string[] = [];
  for (const i of validateAgainst(schema, r.value)) {
    if (tolerateUnknown && i.message.startsWith("unexpected property")) unknownKeys.push(i.path);
    else errors.push(`${file}: ${formatPointer(i.path)}: ${i.message}`);
  }
  if (errors.length > 0) return { status: "invalid", errors };
  return { status: "ok", value: build(r.value as Record<string, unknown>), unknownKeys };
}

/** Stable JSON text: 2-space indent and a trailing newline. */
export const toJsonText = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

export const sortedEntries = <T>(o: Record<string, T>): [string, T][] =>
  Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
