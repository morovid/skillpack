import { commands } from "./commands/index.js";
import type { Command } from "./commands/types.js";

export function rootHelp(): string {
  const width = Math.max(...[...commands.keys()].map((n) => n.length));
  const lines = [...commands.values()].map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return `Usage: skillpack <command> [options]

Commands:
${lines.join("\n")}

Options:
  -h, --help     Show help (also: skillpack help <command>)
  -v, --version  Show the version
`;
}

export function commandHelp(cmd: Command): string {
  const opts = Object.entries(cmd.options).map(([name, o]) => {
    const short = o.short ? `-${o.short}, ` : "    ";
    const d = cmd.optionHelp[name] ?? "";
    return `  ${short}--${name.padEnd(10)} ${d}`;
  });
  return `Usage: ${cmd.usage}

${cmd.summary}

Options:
${[...opts, "  -h, --help       Show this help"].join("\n")}
`;
}
