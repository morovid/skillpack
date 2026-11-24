import { execFile } from "node:child_process";

export interface RunGitOptions {
  cwd?: string;
  /** Extra environment, merged over process.env. Credentials are never read or stored here. */
  env?: NodeJS.ProcessEnv;
  /** Never prompt on the terminal (sets GIT_TERMINAL_PROMPT=0). */
  nonInteractive?: boolean;
}

export class GitError extends Error {
  constructor(message: readonly string[] | string, readonly code: "not-found" | "failed", readonly stderr = "") {
    super(typeof message === "string" ? message : message.join(" "));
    this.name = "GitError";
  }
}

export function runGit(args: readonly string[], options: RunGitOptions = {}): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  if (options.nonInteractive) env.GIT_TERMINAL_PROMPT = "0";
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd: options.cwd, env, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return reject(new GitError("git was not found on PATH; install git to use skillpack with remote packs", "not-found"));
        }
        const detail = stderr.trim() || error.message;
        reject(new GitError(`git ${args.join(" ")} failed: ${detail}`, "failed", stderr));
      },
    );
  });
}
