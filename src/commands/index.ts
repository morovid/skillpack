import type { Command } from "./types.js";
import { build } from "./build/index.js";
import { validate } from "./validate/index.js";

// Adding a command = add a folder under src/commands/ and one line here.
const all: Command[] = [build, validate];

export const commands: ReadonlyMap<string, Command> = new Map(all.map((c) => [c.name, c]));
