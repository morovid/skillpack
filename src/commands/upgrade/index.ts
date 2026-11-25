import { type Command } from "../types.js";
import { MOVE_OPTIONS, MOVE_OPTION_HELP, runMove } from "../update/run-move.js";

export const upgrade: Command = {
  name: "upgrade",
  summary: "Move packs to the newest version overall and rewrite their requested version",
  usage: "skillpack upgrade [pack]... [-a <harness>]... [--include-prerelease] [--force] [--strict] [--dry-run] [-y] [--json]",
  options: { ...MOVE_OPTIONS, "include-prerelease": { type: "boolean" } },
  optionHelp: { ...MOVE_OPTION_HELP, "include-prerelease": "Also consider prerelease versions (1.2.0-beta.1)" },
  run: (ctx) => runMove(ctx, "upgrade"),
};
