import { isTextFile } from "../text-files.js";
import type { TreeFile } from "./tree.js";

export type FileChange = { path: string; status: "added" | "removed" | "changed" };
export type FolderStatus = "added" | "removed" | "changed";
export interface FolderDiff {
  name: string;
  status: FolderStatus;
  files: FileChange[];
}
export interface TreeDiff {
  folders: FolderDiff[];
  unchanged: string[];
}

const normalized = (f: TreeFile): Buffer =>
  isTextFile(f.path) ? Buffer.from(f.content.toString("utf8").replaceAll("\r\n", "\n")) : f.content;

/**
 * Compares the expected tree with what is on disk, per file. "added" = expected but missing on
 * disk; "removed" = on disk but not expected. Text files are compared with CRLF as LF.
 */
export function diffFiles(expected: TreeFile[], actual: TreeFile[]): FileChange[] {
  const have = new Map(actual.map((f) => [f.path, f]));
  const want = new Set(expected.map((f) => f.path));
  const out: FileChange[] = [];
  for (const f of expected) {
    const a = have.get(f.path);
    if (!a) out.push({ path: f.path, status: "added" });
    else if (a.mode !== f.mode || !normalized(a).equals(normalized(f))) out.push({ path: f.path, status: "changed" });
  }
  for (const a of actual) if (!want.has(a.path)) out.push({ path: a.path, status: "removed" });
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

const topOf = (path: string): string => path.split("/")[0]!;

/** Like diffFiles, grouped by the first path segment (a skill folder). */
export function diffFolders(expected: TreeFile[], actual: TreeFile[]): TreeDiff {
  const changes = diffFiles(expected, actual);
  const inExpected = new Set(expected.map((f) => topOf(f.path)));
  const inActual = new Set(actual.map((f) => topOf(f.path)));
  const all = [...new Set([...inExpected, ...inActual])].sort();
  const folders: FolderDiff[] = [];
  const unchanged: string[] = [];
  for (const name of all) {
    const files = changes.filter((c) => topOf(c.path) === name);
    if (files.length === 0) unchanged.push(name);
    else
      folders.push({
        name,
        status: !inActual.has(name) ? "added" : !inExpected.has(name) ? "removed" : "changed",
        files,
      });
  }
  return { folders, unchanged };
}
