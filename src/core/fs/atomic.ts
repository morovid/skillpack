import { existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { TreeFile } from "./tree.js";

export interface FolderTarget {
  /** Absolute path of the folder to replace. */
  dir: string;
  /** The complete new content. An empty list removes the folder. */
  files: TreeFile[];
}

/** One step of a transaction. Paths are absolute. */
export type FsChange =
  | { kind: "replace-dir"; dir: string; files: TreeFile[] }
  | { kind: "remove-dir"; dir: string }
  | { kind: "write-file"; path: string; content: Buffer | string; mode?: number }
  | { kind: "remove-file"; path: string };

export interface TransactionHooks {
  /** Called before each commit step (0-based). Test seam for injecting failures. */
  beforeCommit?: (index: number, change: FsChange) => void;
}

const targetOf = (c: FsChange): string => (c.kind === "replace-dir" || c.kind === "remove-dir" ? c.dir : c.path);
const exists = (p: string): boolean => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/** The topmost ancestor of `dir` that doesn't exist yet, or null when `dir` exists. */
function topMissing(dir: string): string | null {
  let top: string | null = null;
  for (let d = dir; !existsSync(d); d = dirname(d)) {
    top = d;
    if (dirname(d) === d) break;
  }
  return top;
}

/**
 * Applies all changes or none (R-SAF-2). New content is written to temporary siblings first; then
 * each target is swapped in, keeping the old one as a backup. If anything fails, the swaps are
 * undone in reverse order, temporary files and newly created folders are removed, and the error
 * is rethrown. Backups are deleted only after every step succeeded.
 */
export function applyFsChanges(changes: FsChange[], hooks: TransactionHooks = {}): void {
  const id = randomBytes(4).toString("hex");
  const steps = changes.map((change, i) => {
    const target = targetOf(change);
    const parent = dirname(target);
    const hasNew = change.kind === "replace-dir" || change.kind === "write-file";
    return {
      change,
      target,
      tmp: hasNew ? join(parent, `.skillpack-tmp-${id}-${i}`) : null,
      backup: join(parent, `.skillpack-bak-${id}-${i}`),
      replaced: false,
    };
  });
  const createdDirs: string[] = [];

  try {
    for (const s of steps) {
      const missing = topMissing(dirname(s.target));
      if (missing !== null) createdDirs.push(missing);
      mkdirSync(dirname(s.target), { recursive: true });
      const c = s.change;
      if (c.kind === "replace-dir") {
        for (const f of c.files) {
          const abs = join(s.tmp!, ...f.path.split("/"));
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, f.content, { mode: f.mode });
        }
        mkdirSync(s.tmp!, { recursive: true });
      } else if (c.kind === "write-file") {
        writeFileSync(s.tmp!, c.content, { mode: c.mode ?? 0o644 });
      }
    }

    steps.forEach((s, i) => {
      hooks.beforeCommit?.(i, s.change);
      if (exists(s.target)) renameSync(s.target, s.backup);
      s.replaced = true;
      if (s.tmp !== null) renameSync(s.tmp, s.target);
    });
  } catch (e) {
    for (const s of [...steps].reverse()) {
      try {
        if (s.replaced) {
          if (s.tmp !== null) rmSync(s.target, { recursive: true, force: true });
          if (exists(s.backup)) renameSync(s.backup, s.target);
        }
      } catch {
        // best effort: the backup stays next to the target
      }
    }
    for (const s of steps) if (s.tmp !== null) rmSync(s.tmp, { recursive: true, force: true });
    for (const d of createdDirs.reverse()) rmSync(d, { recursive: true, force: true });
    throw e;
  }
  for (const s of steps) rmSync(s.backup, { recursive: true, force: true });
}

/** Replaces each target folder with the given content; an empty file list removes the folder. */
export function replaceFolders(targets: FolderTarget[]): void {
  applyFsChanges(
    targets.map((t): FsChange =>
      t.files.length > 0 ? { kind: "replace-dir", dir: t.dir, files: t.files } : { kind: "remove-dir", dir: t.dir },
    ),
  );
}

export function replaceFolder(dir: string, files: TreeFile[]): void {
  replaceFolders([{ dir, files }]);
}
