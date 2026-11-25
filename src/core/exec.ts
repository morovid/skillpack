import { execFile } from "node:child_process";

export class CommandError extends Error {
  constructor(
    message: string,
    readonly code: "not-found" | "failed" | "timeout",
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/** Runs a program (never through a shell) and returns its stdout. Used for `opencode models` and `codex debug models`. */
export function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { cwd: options.cwd, env: { ...process.env, ...options.env }, timeout: options.timeoutMs ?? 20_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const e = error as NodeJS.ErrnoException & { killed?: boolean };
        if (e.code === "ENOENT") return reject(new CommandError(`${command} was not found on PATH`, "not-found"));
        if (e.killed) return reject(new CommandError(`${command} ${args.join(" ")} timed out`, "timeout"));
        reject(new CommandError(`${command} ${args.join(" ")} failed: ${stderr.trim() || e.message}`, "failed"));
      },
    );
  });
}
