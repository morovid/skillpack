import { resolve } from "node:path";
import { createStyle, formatDiagnostics, plural } from "../../core/output.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type Command } from "../types.js";
import { validatePack } from "./validate-pack.js";

export const validate: Command = {
  name: "validate",
  summary: "Validate a pack's configuration files and sources",
  usage: "skillpack validate [dir] [--strict] [--json]",
  options: {
    strict: { type: "boolean" },
    json: { type: "boolean" },
  },
  optionHelp: {
    strict: "Treat warnings as errors",
    json: "Print diagnostics as JSON",
  },
  async run(ctx) {
    if (ctx.positionals.length > 1) throw new UsageError("expected at most one directory");
    const dir = resolve(ctx.cwd, ctx.positionals[0] ?? ".");
    const strict = ctx.values.strict === true;
    const result = validatePack(dir, { cliVersion: CLI_VERSION });
    const { diagnostics: diag } = result;
    const failed = diag.errorCount > 0 || (strict && diag.warningCount > 0);

    if (ctx.values.json === true) {
      ctx.stdout(
        JSON.stringify(
          {
            valid: !failed,
            pack: result.name ?? null,
            skills: result.skills,
            agents: result.agents,
            errors: diag.errorCount,
            warnings: diag.warningCount,
            diagnostics: diag.items,
          },
          null,
          2,
        ) + "\n",
      );
      return failed ? 1 : 0;
    }

    const s = createStyle(ctx.color);
    ctx.stdout(formatDiagnostics(diag.items, s));

    if (failed) {
      const note = strict && diag.errorCount === 0 ? " (--strict)" : "";
      ctx.stdout(
        s.red(`✖ ${plural(diag.errorCount, "error")}, ${plural(diag.warningCount, "warning")}${note}`) + "\n",
      );
    } else {
      const warn = diag.warningCount > 0 ? `, ${plural(diag.warningCount, "warning")}` : "";
      ctx.stdout(
        s.green(
          `✔ pack "${result.name}" is valid (${plural(result.skills, "skill")}, ${plural(result.agents, "agent")}${warn})`,
        ) + "\n",
      );
    }
    return failed ? 1 : 0;
  },
};
