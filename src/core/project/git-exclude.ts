import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { updateExcludeBlock } from "./exclude.js";
import { runGit } from "../git/index.js";
import type { ProjectOp } from "./changes.js";

/** Absolute path of the repository's info/exclude (shared by worktrees), or null outside a repo. */
export async function findGitExcludePath(projectDir: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const out = (await runGit(["rev-parse", "--git-path", "info/exclude"], { cwd: projectDir, ...(env ? { env } : {}) })).trim();
    return out ? resolve(projectDir, out) : null;
  } catch {
    return null;
  }
}

/**
 * The op that updates the managed block (R-SAF-7), `null` when nothing changes, or
 * `{ outsideRepo: true }` when there's no git repository (callers print the paths instead).
 */
export async function planExcludeUpdate(
  projectDir: string,
  change: { add?: readonly string[]; remove?: readonly string[] },
  env?: NodeJS.ProcessEnv,
): Promise<ProjectOp | null | { outsideRepo: true }> {
  const path = await findGitExcludePath(projectDir, env);
  if (path === null) return { outsideRepo: true };
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = updateExcludeBlock(before, change);
  return after === before ? null : { type: "write-file", path, content: after, label: "exclude" };
}
