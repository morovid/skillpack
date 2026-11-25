import { resolve } from "node:path";
import { GitError } from "../../core/git/index.js";
import { detectHarnesses, systemDetectEnv } from "../../core/harness-detect.js";
import { HARNESSES, isHarness, type Harness } from "../../core/harness.js";
import { PackError } from "../../core/install/fetch-pack.js";
import { planMoveToVersion, type MoveMode } from "../../core/install/move.js";
import { InstallError } from "../../core/install/select.js";
import { formatBlocked, formatSyncReport } from "../../core/install/sync.js";
import { createSystemModelSource } from "../../core/models/available.js";
import { createStyle, formatDiagnostics } from "../../core/output.js";
import { PackRefError, applyChanges, deriveScope, describeChanges, readConfig, readLock, resolvePackRef } from "../../core/project/index.js";
import { SourceError } from "../../core/source/parse.js";
import { VersionError } from "../../core/source/versions.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type CommandContext } from "../types.js";

export const MOVE_OPTIONS = {
  harness: { type: "string", short: "a", multiple: true },
  force: { type: "boolean" },
  strict: { type: "boolean" },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  json: { type: "boolean" },
} as const;

export const MOVE_OPTION_HELP: Record<string, string> = {
  harness: "Touch only this harness's agents, even if it isn't detected (repeatable)",
  force: "Overwrite skill folders and agent files that skillpack doesn't own or that were edited",
  strict: "Fail when a model can't be matched or verified (instead of generating the agent without one)",
  "dry-run": "Show what would change and write nothing",
  yes: "Don't ask: new agents are generated",
  json: "Print the result as JSON",
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");

/** Shared by `update` and `upgrade`: parse, plan with `planMoveToVersion`, apply, print. */
export async function runMove(ctx: CommandContext, mode: MoveMode): Promise<number> {
  const name = mode;
  const flag = strings(ctx.values.harness).flatMap((h) => h.split(",")).map((h) => h.trim()).filter(Boolean);
  for (const h of flag) if (!isHarness(h)) throw new UsageError(`unknown harness "${h}" (use ${HARNESSES.join(", ")})`);
  const dryRun = ctx.values["dry-run"] === true;
  const json = ctx.values.json === true;
  const projectDir = resolve(ctx.cwd);
  const s = createStyle(ctx.color);
  const out = (t: string): void => ctx.stdout(t);
  const fail = (message: string, extra: Record<string, unknown> = {}): number => {
    if (json) out(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + "\n");
    else ctx.stderr(`skillpack ${name}: ${message}\n`);
    return 1;
  };

  const cfgState = readConfig(projectDir);
  if (cfgState.status === "missing") return fail("no skillpack.json; add a pack with skillpack add");
  if (cfgState.status === "invalid") return fail(cfgState.errors.join("\n"));
  const lockState = readLock(projectDir);
  if (lockState.status === "invalid") return fail(lockState.errors.join("\n"));
  const config = cfgState.value;
  const lock = lockState.status === "ok" ? lockState.value : null;

  try {
    let keys = Object.keys(config.packs);
    if (ctx.positionals.length > 0) keys = [...new Set(ctx.positionals.map((r) => resolvePackRef(config, r, (k) => deriveScope(projectDir, config, lock, k))))];
    const detected = ctx.detectHarnesses ? ctx.detectHarnesses(projectDir) : detectHarnesses(systemDetectEnv(projectDir, ctx.env));
    const prompts = ctx.interactive && ctx.values.yes !== true ? ctx.prompts : undefined;
    const result = await planMoveToVersion({
      mode,
      projectDir,
      cliVersion: CLI_VERSION,
      config,
      lock,
      keys,
      detected,
      harnessFlag: flag as Harness[],
      force: ctx.values.force === true,
      includePrerelease: ctx.values["include-prerelease"] === true,
      source: ctx.models ?? createSystemModelSource(ctx.env),
      prompts,
      strict: ctx.values.strict === true,
      env: ctx.env,
    });
    if (result.failures.length > 0) return fail(`model problems (--strict); nothing written:\n  ${result.failures.join("\n  ")}`);
    const plan = result.plan;

    if (plan && (plan.conflicts.length > 0 || plan.blocked.length > 0)) {
      if (json) out(JSON.stringify({ ok: false, error: plan.conflicts.length ? "conflict" : "blocked", conflicts: plan.conflicts, blocked: plan.blocked }, null, 2) + "\n");
      else ctx.stderr(formatBlocked(name, plan));
      return 1;
    }
    const changes = plan ? describeChanges(projectDir, plan.ops) : [];
    if (plan && !dryRun && plan.ops.length > 0) applyChanges(projectDir, plan.ops);

    const label = (st: (typeof result.statuses)[number]): string => scopeName(st.key, st.name);
    const scopeName = (key: string, packName: string): string => packName === key ? (deriveScope(projectDir, config, lock, key).best ?? key) : packName;

    if (json) {
      out(JSON.stringify({
        ok: true, dryRun, mode,
        packs: result.statuses.map((st) => ({ source: st.key, name: st.name, moved: st.kind === "moved", from: st.from, to: st.to ?? null, note: st.note ?? null, newAgents: st.newAgents, removedAgents: st.removedAgents, scopeMove: st.scopeMove ?? null, versionRewrite: st.versionRewrite ?? null })),
        skills: plan?.skillActions ?? [], keptAgents: plan?.keptAgents ?? [], changes, commit: plan?.commitPaths ?? [],
        warnings: plan?.targets.flatMap((t) => t.warnings) ?? [],
      }, null, 2) + "\n");
      return 0;
    }

    for (const st of result.statuses.filter((x) => x.kind === "kept")) {
      const done = /up to date|latest/.test(st.note ?? "");
      out(`${done ? s.green("=") : s.dim("·")} ${label(st)} ${st.from}${st.note ? s.dim(` (${st.note})`) : ""}\n`);
    }
    if (!plan) {
      if (result.statuses.every((x) => x.kind === "kept")) out(s.green(`✔ nothing to ${name}`) + "\n");
      return 0;
    }
    const movedStatuses = result.statuses.filter((x) => x.kind === "moved");
    out(formatSyncReport({
      plan, statuses: result.moved, changes, dryRun, verb: name === "update" ? "updated" : "upgraded", s,
      headline: (_st, i) => {
        const m = movedStatuses[i]!;
        let line = `${s.green("↑")} ${label(m)} ${m.from} → ${m.to}`;
        if (m.versionRewrite) line += `\n    version in skillpack.json: ${m.versionRewrite.from} → ${m.versionRewrite.to}`;
        if (m.scopeMove) line += `\n    the pack's name changed: scope ${m.scopeMove.from} → ${m.scopeMove.to}; skills and agents move to the new prefix`;
        for (const a of m.newAgents) line += `\n    new agent: ${a}`;
        for (const a of m.removedAgents) line += `\n    removed agent: ${a} (binding dropped)`;
        return line;
      },
    }));
    return 0;
  } catch (e) {
    if (e instanceof PackError) {
      if (json) out(JSON.stringify({ ok: false, error: e.message, diagnostics: e.diagnostics }, null, 2) + "\n");
      else {
        out(formatDiagnostics(e.diagnostics, s));
        ctx.stderr(`skillpack ${name}: ${e.message}; nothing written\n`);
      }
      return 1;
    }
    if (e instanceof InstallError || e instanceof PackRefError || e instanceof GitError || e instanceof VersionError || e instanceof SourceError) return fail(e.message);
    throw e;
  }
}
