import { existsSync, readFileSync } from "node:fs";

export type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "missing" | "invalid"; message: string };

export function readJsonFile(path: string): JsonResult {
  if (!existsSync(path)) return { ok: false, reason: "missing", message: "file not found" };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (e) {
    return { ok: false, reason: "invalid", message: `invalid JSON: ${(e as Error).message}` };
  }
}
