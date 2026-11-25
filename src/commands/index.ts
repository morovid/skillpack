import type { Command } from "./types.js";
import { add } from "./add/index.js";
import { build } from "./build/index.js";
import { install } from "./install/index.js";
import { list } from "./list/index.js";
import { remove } from "./remove/index.js";
import { render } from "./render/index.js";
import { validate } from "./validate/index.js";

// Adding a command = add a folder under src/commands/ and one line here.
const all: Command[] = [add, build, install, list, remove, render, validate];

export const commands: ReadonlyMap<string, Command> = new Map(all.map((c) => [c.name, c]));
