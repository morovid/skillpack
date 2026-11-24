import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { diffFolders, type FolderDiff } from "../../core/fs/diff.js";
import { replaceFolder } from "../../core/fs/atomic.js";
import { readTree } from "../../core/fs/tree.js";
import { createStyle, formatDiagnostics, plural } from "../../core/output.js";
import { PLAIN_SKILLS_DIR } from "../../core/paths.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type Command } from "../types.js";
import { validatePack } from "../validate/validate-pack.js";
import { renderPlainBuild } from "./plain-build.js";

const SIGN = { added: "+", changed: "~", removed: "-" } as const;

export const build: Command = {
  name: "build",
  summary: "Build the plain skills/ folder for `npx skills` from src/",
  usage: "skillpack build [dir] [--check] [--json]",
  options: {
    check: { type: "boolean" },
    json: { type: "boolean" },
  },
  optionHelp: {
    check: "Don't write; exit 1 if skills/ is out of date",
    json: "Print the result as JSON",
  },
  async run(ctx) {
    if (ctx.positionals.length > 1) throw new UsageError("expected at most one directory");
    const dir = resolve(ctx.cwd, ctx.positionals[0] ?? ".");
    const check = ctx.values.check === true;
    const json = ctx.values.json === true;
    const s = createStyle(ctx.color);
    const target = join(dir, PLAIN_SKILLS_DIR);
    const out = (text: string): void => ctx.stdout(text);

    const validation = validatePack(dir, { cliVersion: CLI_VERSION });
    const diag = validation.diagnostics;
    if (diag.errorCount > 0 || validation.name === undefined) {
      if (json) {
        out(JSON.stringify({ ok: false, reason: "invalid-pack", diagnostics: diag.items }, null, 2) + "\n");
      } else {
        out(formatDiagnostics(diag.items, s));
        out(s.red(`✖ ${plural(diag.errorCount, "error")}, ${plural(diag.warningCount, "warning")}; nothing built`) + "\n");
      }
      return 1;
    }

    const { files, skills } = renderPlainBuild(dir, validation.name);
    const onDisk = existsSync(target) ? readTree(target) : [];
    const diff = diffFolders(files, onDisk);
    const upToDate = diff.folders.length === 0;

    if (!check && !upToDate) replaceFolder(target, files);

    if (json) {
      out(
        JSON.stringify(
          {
            ok: check ? upToDate : true,
            mode: check ? "check" : "build",
            upToDate,
            written: !check && !upToDate,
            skills: skills.length,
            unchanged: diff.unchanged.length,
            changes: diff.folders,
            diagnostics: diag.items,
          },
          null,
          2,
        ) + "\n",
      );
      return check && !upToDate ? 1 : 0;
    }

    if (diag.warningCount > 0) out(formatDiagnostics(diag.items, s));
    const list = (f: FolderDiff, detail: boolean): void => {
      const color = f.status === "added" ? s.green : f.status === "removed" ? s.red : s.yellow;
      out(`  ${color(SIGN[f.status])} ${f.name}\n`);
      if (detail) {
        for (const c of f.files) {
          const what = c.status === "added" ? "missing" : c.status === "removed" ? "extra" : "differs";
          out(`      ${s.dim(`${c.path} (${what})`)}\n`);
        }
      }
    };

    if (check) {
      if (upToDate) {
        out(s.green(`✔ ${PLAIN_SKILLS_DIR}/ is up to date`) + "\n");
        return 0;
      }
      out(`${PLAIN_SKILLS_DIR}/ is out of date:\n`);
      diff.folders.forEach((f) => list(f, true));
      out(s.red(`✖ ${plural(diff.folders.length, "skill")} out of date; run skillpack build`) + "\n");
      return 1;
    }

    if (upToDate) {
      out(s.green(`✔ ${PLAIN_SKILLS_DIR}/ is already up to date (${plural(skills.length, "skill")}); nothing written`) + "\n");
      return 0;
    }
    diff.folders.forEach((f) => list(f, false));
    if (diff.unchanged.length > 0) out(s.dim(`  ${diff.unchanged.length} unchanged`) + "\n");
    out(s.green(`✔ built ${plural(skills.length, "skill")} into ${PLAIN_SKILLS_DIR}/`) + "\n");
    return 0;
  },
};
