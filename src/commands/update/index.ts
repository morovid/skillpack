import { type Command } from "../types.js";
import { MOVE_OPTIONS, MOVE_OPTION_HELP, runMove } from "./run-move.js";

export const update: Command = {
  name: "update",
  summary: "Move packs to the newest version within their requested range",
  usage: "skillpack update [pack]... [-a <harness>]... [--force] [--strict] [--dry-run] [-y] [--json]",
  options: { ...MOVE_OPTIONS },
  optionHelp: MOVE_OPTION_HELP,
  run: (ctx) => runMove(ctx, "update"),
};
