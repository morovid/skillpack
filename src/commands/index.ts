import type { Command } from "./types.js";
import { add } from "./add/index.js";
import { build } from "./build/index.js";
import { check } from "./check/index.js";
import { configure } from "./configure/index.js";
import { install } from "./install/index.js";
import { list } from "./list/index.js";
import { remove } from "./remove/index.js";
import { render } from "./render/index.js";
import { sync } from "./sync/index.js";
import { update } from "./update/index.js";
import { upgrade } from "./upgrade/index.js";
import { validate } from "./validate/index.js";

// Adding a command = add a folder under src/commands/ and one line here.
const all: Command[] = [add, build, check, configure, install, list, remove, render, sync, update, upgrade, validate];

export const commands: ReadonlyMap<string, Command> = new Map(all.map((c) => [c.name, c]));
