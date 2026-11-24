import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { TreeFile } from "./tree.js";

export interface FolderTarget {
  /** Absolute path of the folder to replace. */
  dir: string;
  /** The complete new content. An empty list removes the folder. */
  files: TreeFile[];
}

const suffix = (): string => randomBytes(4).toString("hex");

/**
 * Replaces each target folder with the given content (R-SAF-2). Everything is first written to
 * temporary siblings; only then are the folders swapped in. If anything fails, the swaps are
 * undone, the temporary folders are removed and the originals are left as they were.
 */
export function replaceFolders(targets: FolderTarget[]): void {
  const id = suffix();
  const staged: { target: FolderTarget; tmp: string | null; backup: string }[] = [];
  const done: typeof staged = [];
  const cleanup: string[] = [];

  try {
    targets.forEach((target, i) => {
      const parent = dirname(target.dir);
      const backup = join(parent, `.skillpack-bak-${id}-${i}`);
      let tmp: string | null = null;
      if (target.files.length > 0) {
        tmp = join(parent, `.skillpack-tmp-${id}-${i}`);
        cleanup.push(tmp);
        for (const f of target.files) {
          const abs = join(tmp, ...f.path.split("/"));
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, f.content, { mode: f.mode });
        }
      }
      staged.push({ target, tmp, backup });
    });

    for (const s of staged) {
      const existed = existsSync(s.target.dir);
      if (existed) renameSync(s.target.dir, s.backup);
      done.push(s);
      if (s.tmp !== null) {
        mkdirSync(dirname(s.target.dir), { recursive: true });
        renameSync(s.tmp, s.target.dir);
      }
    }
  } catch (e) {
    for (const s of [...done].reverse()) {
      try {
        if (s.tmp !== null) rmSync(s.target.dir, { recursive: true, force: true });
        if (existsSync(s.backup)) renameSync(s.backup, s.target.dir);
      } catch {
        // best effort: the backup stays next to the target
      }
    }
    for (const t of cleanup) rmSync(t, { recursive: true, force: true });
    throw e;
  }
  for (const s of staged) rmSync(s.backup, { recursive: true, force: true });
}

export function replaceFolder(dir: string, files: TreeFile[]): void {
  replaceFolders([{ dir, files }]);
}
