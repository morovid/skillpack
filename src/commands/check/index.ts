import { resolve } from "node:path";
import { checkPack, type PackCheck } from "../../core/install/check.js";
import { lsRemote } from "../../core/git/index.js";
import { createStyle } from "../../core/output.js";
import { PackRefError, deriveScope, formatLockedRef, readConfig, readLock, resolvePackRef } from "../../core/project/index.js";
import { parseSourceSpec } from "../../core/source/parse.js";
import { type Command } from "../types.js";

interface Row {
  key: string;
  scope: string;
  requested: string;
  locked: string | null;
  check?: PackCheck;
  error?: string;
}

export const check: Command = {
  name: "check",
  summary: "Show newer versions of the configured packs (read-only)",
  usage: "skillpack check [pack]... [--include-prerelease] [--exit-code] [--json]",
  options: {
    json: { type: "boolean" },
    "exit-code": { type: "boolean" },
    "include-prerelease": { type: "boolean" },
  },
  optionHelp: {
    json: "Print the result as JSON",
    "exit-code": "Exit 1 when anything is outdated (for CI)",
    "include-prerelease": "Also consider prerelease versions for upgrade",
  },
  async run(ctx) {
    const projectDir = resolve(ctx.cwd);
    const json = ctx.values.json === true;
    const s = createStyle(ctx.color);
    const cfgState = readConfig(projectDir);
    if (cfgState.status === "missing") {
      ctx.stderr("skillpack check: no skillpack.json; add a pack with skillpack add\n");
      return 1;
    }
    if (cfgState.status === "invalid") {
      ctx.stderr(`skillpack check: ${cfgState.errors.join("\n")}\n`);
      return 1;
    }
    const lockState = readLock(projectDir);
    if (lockState.status === "invalid") {
      ctx.stderr(`skillpack check: ${lockState.errors.join("\n")}\n`);
      return 1;
    }
    const config = cfgState.value;
    const lock = lockState.status === "ok" ? lockState.value : null;

    let keys = Object.keys(config.packs);
    if (ctx.positionals.length > 0) {
      try {
        keys = [...new Set(ctx.positionals.map((r) => resolvePackRef(config, r, (k) => deriveScope(projectDir, config, lock, k))))];
      } catch (e) {
        if (e instanceof PackRefError) {
          ctx.stderr(`skillpack check: ${e.message}\n`);
          return 1;
        }
        throw e;
      }
    }

    const rows: Row[] = [];
    for (const key of keys) {
      const cfg = config.packs[key]!;
      const entry = lock?.packs[key];
      const row: Row = { key, scope: deriveScope(projectDir, config, lock, key).best ?? key, requested: cfg.version, locked: entry ? formatLockedRef(entry.ref, entry.commit) : null };
      if (entry) {
        try {
          const remote = await lsRemote(parseSourceSpec(key).cloneUrl, { env: ctx.env });
          row.check = checkPack(cfg.version, entry, remote, { includePrerelease: ctx.values["include-prerelease"] === true });
        } catch (e) {
          row.error = (e as Error).message.split("\n")[0]!;
        }
      }
      rows.push(row);
    }
    const outdated = rows.some((r) => r.check && (r.check.update || r.check.upgrade));
    const failed = rows.some((r) => r.error);
    const code = failed || (ctx.values["exit-code"] === true && outdated) ? 1 : 0;

    if (json) {
      ctx.stdout(JSON.stringify({
        outdated,
        packs: rows.map((r) => ({
          source: r.key, scope: r.scope, requested: r.requested, locked: r.locked, installed: r.locked !== null,
          update: r.check?.update ? { to: r.check.update.label, ref: r.check.update.ref, commit: r.check.update.commit } : null,
          upgrade: r.check?.upgrade ? { to: r.check.upgrade.label, ref: r.check.upgrade.ref, commit: r.check.upgrade.commit } : null,
          notes: r.check?.notes ?? [], error: r.error ?? null,
        })),
      }, null, 2) + "\n");
      return code;
    }

    const head = ["pack", "requested", "locked", "update", "upgrade"];
    const body = rows.map((r) => [
      r.scope, r.requested, r.locked ?? "-",
      r.check?.update ? (r.check.update.resolved.kind === "branch" ? `${r.check.update.resolved.saved} moved: ${r.locked!.split("@")[1] ?? r.locked} → ${r.check.update.commit.slice(0, 7)}` : r.check.update.label) : "-",
      r.check?.upgrade ? r.check.upgrade.label : "-",
    ]);
    const w = head.map((_, i) => Math.max(...[head, ...body].map((r) => r[i]!.length)));
    const line = (cells: string[]): string => `  ${cells.map((c, i) => c.padEnd(w[i]!)).join("  ").trimEnd()}\n`;
    ctx.stdout(s.dim(line(head)));
    for (const r of body) ctx.stdout(line(r));
    for (const r of rows) {
      if (r.locked === null) ctx.stdout(`  ${s.yellow(r.scope)}: not installed (run skillpack install)\n`);
      if (r.error) ctx.stdout(`  ${s.red(r.scope)}: couldn't reach the remote: ${r.error}\n`);
      for (const n of r.check?.notes ?? []) ctx.stdout(s.dim(`  ${r.scope}: ${n}`) + "\n");
    }
    if (rows.some((r) => r.check?.update)) ctx.stdout("\nRun skillpack update to move within the requested range.\n");
    if (rows.some((r) => r.check?.upgrade)) ctx.stdout("Run skillpack upgrade to move to the newest version and rewrite the requested one.\n");
    if (!outdated && !failed && rows.every((r) => r.locked !== null)) ctx.stdout(s.green("\n✔ everything is up to date") + "\n");
    if (ctx.positionals.length === 0 && keys.length === 0) ctx.stdout("no packs configured\n");
    return code;
  },
};
