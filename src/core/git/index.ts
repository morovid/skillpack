import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitError, runGit, type RunGitOptions } from "./run.js";

export { GitError, runGit, type RunGitOptions } from "./run.js";

export interface RemoteRefs {
  /** Tag name -> commit sha (the peeled commit for annotated tags). */
  tags: Map<string, string>;
  branches: Map<string, string>;
  head: { branch?: string; sha: string };
}

type GitOpts = Pick<RunGitOptions, "env" | "nonInteractive">;

export function parseLsRemote(output: string): RemoteRefs {
  const tags = new Map<string, string>();
  const peeled = new Map<string, string>();
  const branches = new Map<string, string>();
  let headBranch: string | undefined;
  let headSha: string | undefined;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const symref = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line);
    if (symref) {
      headBranch = symref[1];
      continue;
    }
    const [sha, ref] = line.split("\t");
    if (!sha || !ref) continue;
    if (ref === "HEAD") headSha = sha;
    else if (ref.startsWith("refs/heads/")) branches.set(ref.slice("refs/heads/".length), sha);
    else if (ref.startsWith("refs/tags/")) {
      const name = ref.slice("refs/tags/".length);
      if (name.endsWith("^{}")) peeled.set(name.slice(0, -3), sha);
      else tags.set(name, sha);
    }
  }
  for (const [name, sha] of peeled) tags.set(name, sha);
  if (!headSha) throw new GitError("repository has no commits (no HEAD)", "failed");
  const head: RemoteRefs["head"] = { sha: headSha };
  if (headBranch) head.branch = headBranch;
  return { tags, branches, head };
}

export async function lsRemote(url: string, options: GitOpts = {}): Promise<RemoteRefs> {
  const out = await runGit(["ls-remote", "--symref", url, "HEAD", "refs/heads/*", "refs/tags/*"], options);
  return parseLsRemote(out);
}

/** Fetch one commit into `dest`; falls back to a full fetch when the server refuses fetch-by-sha (R-SRC-5). Returns the full HEAD sha. */
export async function fetchCommit(url: string, sha: string, dest: string, options: GitOpts = {}): Promise<string> {
  await mkdir(dest, { recursive: true });
  const o = { ...options, cwd: dest };
  await runGit(["init", "--quiet"], o);
  // a throwaway checkout: no background gc or maintenance (it races with the cleanup)
  await runGit(["config", "gc.auto", "0"], o);
  await runGit(["config", "maintenance.auto", "false"], o);
  await runGit(["remote", "add", "origin", url], o);
  try {
    await runGit(["fetch", "--quiet", "--depth", "1", "origin", sha], o);
    await runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], o);
  } catch (e) {
    if (e instanceof GitError && e.code === "not-found") throw e;
    await runGit(["fetch", "--quiet", "--tags", "origin", "+refs/heads/*:refs/remotes/origin/*"], o);
    await runGit(["checkout", "--quiet", "--detach", sha], o);
  }
  return (await runGit(["rev-parse", "HEAD"], o)).trim();
}

/** Shallow-clone a branch or tag into `dest`. Returns the HEAD sha. */
export async function fetchRef(url: string, ref: string, dest: string, options: GitOpts = {}): Promise<string> {
  await mkdir(dest, { recursive: true });
  await runGit(["clone", "--quiet", "--depth", "1", "--branch", ref, url, dest], options);
  return (await runGit(["rev-parse", "HEAD"], { ...options, cwd: dest })).trim();
}

/** Runs `fn` with a fresh temp directory that is always removed afterwards (R-SRC-5). */
export async function withTempCheckout<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "skillpack-"));
  try {
    return await fn(dir);
  } finally {
    // git may still have a background process (auto gc/maintenance) writing into the checkout; retry on ENOTEMPTY
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
