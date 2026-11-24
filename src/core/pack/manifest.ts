import { join } from "node:path";
import { MANIFEST_FILE } from "../paths.js";
import { readJsonFile, type JsonResult } from "./json.js";

export interface PackManifestFile {
  /** Path relative to the pack root. */
  file: string;
  result: JsonResult;
}

export function loadPackManifest(dir: string): PackManifestFile {
  return { file: MANIFEST_FILE, result: readJsonFile(join(dir, MANIFEST_FILE)) };
}
