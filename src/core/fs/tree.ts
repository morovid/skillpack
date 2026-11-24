import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** A file in memory. `path` is posix-style and relative to the tree root. */
export interface TreeFile {
  path: string;
  content: Buffer;
  /** Normalized to 0o755 (executable) or 0o644, so it doesn't depend on the umask. */
  mode: number;
}

export const normalizeMode = (mode: number): number => ((mode & 0o111) !== 0 ? 0o755 : 0o644);

export const sortFiles = <T extends { path: string }>(files: T[]): T[] =>
  [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

const IGNORED = new Set([".DS_Store"]);

/** Reads a folder recursively into memory. Never executes anything. Symlinks are skipped. */
export function readTree(root: string): TreeFile[] {
  const out: TreeFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED.has(e.name)) continue;
      const abs = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, rel);
      else if (e.isFile()) {
        out.push({ path: rel, content: readFileSync(abs), mode: normalizeMode(statSync(abs).mode) });
      }
    }
  };
  walk(root, "");
  return sortFiles(out);
}
