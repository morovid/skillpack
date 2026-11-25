import { parseArgs } from "node:util";
import { commands } from "./commands/index.js";
import { UsageError, type CommandContext } from "./commands/types.js";
import type { Harness } from "./core/harness.js";
import type { ModelSource } from "./core/models/available.js";
import { CancelledError, createClackPrompts, isInteractive, type Prompts } from "./core/prompts/index.js";
import { colorEnabled } from "./core/output.js";
import { CLI_VERSION } from "./core/version.js";
import { commandHelp, rootHelp } from "./help.js";

export interface Io {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  color: boolean;
  /** Environment for git and harness detection. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Test seam: replaces harness detection (R-CLI-4). */
  detectHarnesses?: (projectDir: string) => Harness[];
  /** Default: stdin and stdout are terminals. */
  interactive?: boolean;
  /** Default: terminal prompts (only created when interactive). */
  prompts?: Prompts;
  /** Test seam for the available models. */
  models?: ModelSource;
}

export const defaultIo = (): Io => ({
  cwd: process.cwd(),
  stdout: (t) => void process.stdout.write(t),
  stderr: (t) => void process.stderr.write(t),
  color: colorEnabled(process.stdout),
});

/** Runs the CLI and returns the exit code: 0 ok, 1 failure, 2 usage error. */
export async function main(argv: string[], io: Io = defaultIo()): Promise<number> {
  const [first, ...rest] = argv;

  if (first === undefined || first === "-h" || first === "--help") {
    io.stdout(rootHelp());
    return 0;
  }
  if (first === "-v" || first === "--version") {
    io.stdout(`${CLI_VERSION}\n`);
    return 0;
  }
  if (first === "help") {
    const target = rest[0];
    if (target === undefined) {
      io.stdout(rootHelp());
      return 0;
    }
    const cmd = commands.get(target);
    if (!cmd) return unknown(target, io);
    io.stdout(commandHelp(cmd));
    return 0;
  }

  const cmd = commands.get(first);
  if (!cmd) return unknown(first, io);

  try {
    const parsed = parseArgs({
      args: rest,
      options: { ...cmd.options, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
      strict: true,
    });
    if (parsed.values.help) {
      io.stdout(commandHelp(cmd));
      return 0;
    }
    const interactive = io.interactive ?? isInteractive();
    const ctx: CommandContext = {
      values: parsed.values as CommandContext["values"],
      positionals: parsed.positionals,
      cwd: io.cwd,
      stdout: io.stdout,
      stderr: io.stderr,
      color: io.color,
      env: io.env ?? process.env,
      interactive,
      ...(io.models ? { models: io.models } : {}),
      ...(io.prompts ? { prompts: io.prompts } : interactive ? { prompts: createClackPrompts() } : {}),
      ...(io.detectHarnesses ? { detectHarnesses: io.detectHarnesses } : {}),
    };
    return await cmd.run(ctx);
  } catch (e) {
    if (e instanceof CancelledError) {
      io.stderr("skillpack: cancelled; nothing was written\n");
      return 130;
    }
    const isUsage =
      e instanceof UsageError || (e instanceof Error && (e as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS"));
    if (isUsage) {
      io.stderr(`skillpack ${cmd.name}: ${(e as Error).message}\n\n${commandHelp(cmd)}`);
      return 2;
    }
    io.stderr(`skillpack: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

function unknown(name: string, io: Io): number {
  io.stderr(`skillpack: unknown command "${name}"\n\n${rootHelp()}`);
  return 2;
}
