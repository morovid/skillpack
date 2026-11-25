import type { ParseArgsConfig } from "node:util";
import type { Harness } from "../core/harness.js";
import type { ModelSource } from "../core/models/available.js";
import type { Prompts } from "../core/prompts/index.js";

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
  /** True when prompts may run: both stdin and stdout are terminals. */
  interactive: boolean;
  prompts?: Prompts;
  /** Test seam: where available models come from (default: `opencode models` and the Codex catalog). */
  models?: ModelSource;
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
