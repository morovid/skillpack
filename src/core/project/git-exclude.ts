import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { updateExcludeBlock } from "./exclude.js";
import type { ProjectOp } from "./changes.js";

// NOTE: a small local execFile; switch to the shared git wrapper in src/core/git once it exists.
function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((done) => {
    execFile("git", args, { cwd, timeout: 10_000 }, (err, stdout) => done(err ? null : stdout.trim()));
  });
}

/** Absolute path of the repository's info/exclude (shared by worktrees), or null outside a repo. */
export async function findGitExcludePath(projectDir: string): Promise<string | null> {
  const out = await git(projectDir, ["rev-parse", "--git-path", "info/exclude"]);
  return out ? resolve(projectDir, out) : null;
}

/**
 * The op that updates the managed block (R-SAF-7), `null` when nothing changes, or
 * `{ outsideRepo: true }` when there's no git repository (callers print the paths instead).
 */
export async function planExcludeUpdate(
  projectDir: string,
  change: { add?: readonly string[]; remove?: readonly string[] },
): Promise<ProjectOp | null | { outsideRepo: true }> {
  const path = await findGitExcludePath(projectDir);
  if (path === null) return { outsideRepo: true };
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = updateExcludeBlock(before, change);
  return after === before ? null : { type: "write-file", path, content: after, label: "exclude" };
}
