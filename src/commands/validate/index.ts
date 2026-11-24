import { resolve } from "node:path";
import { createStyle, plural } from "../../core/output.js";
import type { Diagnostic } from "../../core/diagnostics.js";
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
    const groups = new Map<string, Diagnostic[]>();
    for (const d of diag.items) {
      const key = d.file ?? "";
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
    for (const key of keys) {
      ctx.stdout(`${s.bold(key === "" ? "(pack)" : key)}\n`);
      for (const d of groups.get(key)!) {
        const label = d.level === "error" ? s.red("error  ") : s.yellow("warning");
        const line = d.line !== undefined ? s.dim(`:${d.line}`.padEnd(5)) : "     ";
        ctx.stdout(`  ${line} ${label}  ${d.message}  ${s.dim(d.code)}\n`);
      }
      ctx.stdout("\n");
    }

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
