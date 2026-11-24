import type { ParseArgsConfig } from "node:util";
import type { Harness } from "../core/harness.js";

export type ParsedValues = Record<string, string | boolean | (string | boolean)[] | undefined>;

export interface CommandContext {
  values: ParsedValues;
  positionals: string[];
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  color: boolean;
  env: NodeJS.ProcessEnv;
  detectHarnesses?: (projectDir: string) => Harness[];
}

export interface Command {
  name: string;
  summary: string;
  usage: string;
  options: NonNullable<ParseArgsConfig["options"]>;
  /** Help text per option name. */
  optionHelp: Record<string, string>;
  /** Returns the process exit code. Throw UsageError for bad usage (exit 2). */
  run(ctx: CommandContext): Promise<number>;
}

export class UsageError extends Error {}
