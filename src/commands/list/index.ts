import { resolve } from "node:path";
import { detectHarnesses, systemDetectEnv } from "../../core/harness-detect.js";
import { HARNESS_INFO } from "../../core/harness.js";
import { createStyle, type Style } from "../../core/output.js";
import {
  PackRefError, deriveScope, describePack, formatLockedRef, readConfig, readLock, resolvePackRef, type PackDescription,
} from "../../core/project/index.js";
import { UsageError, type Command } from "../types.js";

const STATUS_TEXT: Record<string, string> = {
  ok: "ok",
  edited: "edited",
  missing: "missing",
  foreign: "foreign file in the way",
  "not-detected": "not generated (harness not detected)",
  unknown: "unknown (scope can't be derived yet)",
};

function paint(s: Style, status: string, text: string): string {
  return status === "ok" ? s.green(text) : status === "not-detected" || status === "unknown" ? s.dim(text) : s.yellow(text);
}

export const list: Command = {
  name: "list",
  summary: "Show the configured packs and the state of their files",
  usage: "skillpack list [pack] [--agents] [--json]",
  options: {
    json: { type: "boolean" },
    agents: { type: "boolean" },
  },
  optionHelp: {
    json: "Print everything as JSON",
    agents: "Also list the generated agent files",
  },
  async run(ctx) {
    if (ctx.positionals.length > 1) throw new UsageError("expected at most one pack");
    const projectDir = resolve(ctx.cwd);
    const json = ctx.values.json === true;
    const s = createStyle(ctx.color);
    const out = (t: string): void => ctx.stdout(t);

    const cfgState = readConfig(projectDir);
    if (cfgState.status === "invalid") {
      ctx.stderr(`skillpack list: ${cfgState.errors.join("\n")}\n`);
      return 1;
    }
    const lockState = readLock(projectDir);
    if (lockState.status === "invalid") {
      ctx.stderr(`skillpack list: ${lockState.errors.join("\n")}\n`);
      return 1;
    }
    const lock = lockState.status === "ok" ? lockState.value : null;
    if (cfgState.status === "missing" || Object.keys(cfgState.value.packs).length === 0) {
      const orphaned = Object.keys(lock?.packs ?? {});
      if (json) out(JSON.stringify({ packs: [], orphaned: orphaned.map((key) => ({ key })) }, null, 2) + "\n");
      else {
        out("no packs configured; add one with skillpack add\n");
        for (const k of orphaned) out(`${k}  ${s.yellow("orphaned (run skillpack install)")}\n`);
      }
      return 0;
    }
    const config = cfgState.value;

    let keys = Object.keys(config.packs);
    const filter = ctx.positionals[0];
    if (filter !== undefined) {
      try {
        keys = [resolvePackRef(config, filter, (k) => deriveScope(projectDir, config, lock, k))];
      } catch (e) {
        if (e instanceof PackRefError) {
          ctx.stderr(`skillpack list: ${e.message}\n`);
          return 1;
        }
        throw e;
      }
    }
    const detected = ctx.detectHarnesses ? ctx.detectHarnesses(projectDir) : detectHarnesses(systemDetectEnv(projectDir, ctx.env));
    const packs = keys.map((k) => describePack(projectDir, config, lock, k, detected));
    const orphaned = filter === undefined ? Object.keys(lock?.packs ?? {}).filter((k) => !(k in config.packs)) : [];

    if (json) {
      out(
        JSON.stringify(
          {
            packs: packs.map((p) => ({ ...p, installed: p.locked !== null })),
            orphaned: orphaned.map((key) => ({ key, ref: lock!.packs[key]!.ref, commit: lock!.packs[key]!.commit })),
          },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }

    const verbose = filter !== undefined;
    const block = (p: PackDescription): string => {
      let o = `${s.bold(p.scope ?? "(scope unknown)")}  ${s.dim(p.key)}\n`;
      const locked = p.locked ? formatLockedRef(p.locked.ref, p.locked.commit) : s.yellow("not locked");
      o += `  version    ${p.requested} → ${locked}\n`;
      if (verbose && p.locked) o += `  commit     ${p.locked.commit}\n`;
      if (verbose) o += `  scope      ${p.scope ?? "unknown"}${p.explicitScope ? " (--as)" : p.scopeExact ? "" : " (guessed from the installed folders)"}\n`;
      o += `  harnesses  ${p.harnesses.map((h) => HARNESS_INFO[h].displayName).join(", ")}\n`;
      if (!p.locked) o += `  ${s.yellow("not installed (run skillpack install)")}\n`;
      const skillsLine = p.skills === "*" ? "*" : p.skills.join(", ");
      o += `  skills     ${skillsLine}\n`;
      const width = Math.max(0, ...p.skillFolders.map((f) => f.path.split("/").pop()!.length));
      for (const f of p.skillFolders) {
        o += `    ${f.path.split("/").pop()!.padEnd(width)}  ${paint(s, f.status, f.status)}\n`;
      }
      const agents = Object.keys(p.bindings);
      if (agents.length > 0) {
        o += `  agents\n`;
        const head = ["agent", ...p.harnesses.map((h) => HARNESS_INFO[h].displayName)];
        const rows = agents.map((a) => [
          a,
          ...p.harnesses.map((h) => {
            const b = p.bindings[a]?.[h] ?? "generate";
            const file = p.agentFiles.find((f) => f.agent === a && f.harness === h);
            return file ? `${b} · ${STATUS_TEXT[file.status]}` : b;
          }),
        ]);
        const w = head.map((_, i) => Math.max(...[head, ...rows].map((r) => r[i]!.length)));
        for (const [i, r] of [head, ...rows].entries()) {
          const line = `    ${r.map((c, j) => c.padEnd(w[j]!)).join("  ").trimEnd()}\n`;
          o += i === 0 ? s.dim(line) : line;
        }
        if (ctx.values.agents === true || verbose) {
          for (const f of p.agentFiles) {
            if (f.path) o += `    ${f.path}  ${paint(s, f.status, STATUS_TEXT[f.status]!)}\n`;
          }
        }
      }
      return o;
    };
    out(packs.map(block).join("\n"));
    for (const k of orphaned) out(`\n${s.bold(k)}  ${s.yellow("orphaned (run skillpack install)")}\n`);
    return 0;
  },
};
