import { resolve } from "node:path";
import { GitError } from "../../core/git/index.js";
import { detectHarnesses, systemDetectEnv } from "../../core/harness-detect.js";
import { HARNESSES, HARNESS_INFO, isHarness, type Harness } from "../../core/harness.js";
import { PackError } from "../../core/install/fetch-pack.js";
import { prepareTargets, removedKeys } from "../../core/install/from-config.js";
import { planProjectInstall } from "../../core/install/project.js";
import { InstallError } from "../../core/install/select.js";
import { createStyle, formatAgentWarnings, formatDiagnostics, plural } from "../../core/output.js";
import {
  PackRefError, applyChanges, deriveScope, describeChanges, formatChangeDescriptions, formatLockedRef, readConfig, readLock,
  resolvePackRef, type BlockedItem,
} from "../../core/project/index.js";
import { SourceError } from "../../core/source/parse.js";
import { VersionError } from "../../core/source/versions.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type Command } from "../types.js";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
const harnessOfPath = (p: string): Harness | null => HARNESSES.find((h) => p.startsWith(`.${h}/`)) ?? null;
const why = (b: BlockedItem): string =>
  b.reason === "foreign" ? "not installed by skillpack" : b.reason === "edited" ? "edited since install" : "installed by another pack";

export const sync: Command = {
  name: "sync",
  summary: "Regenerate skills and agents from skillpack.json at the locked commits",
  usage: "skillpack sync [pack]... [-a <harness>]... [--force] [--dry-run] [-y] [--json]",
  options: {
    harness: { type: "string", short: "a", multiple: true },
    force: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    json: { type: "boolean" },
  },
  optionHelp: {
    harness: "Touch only this harness's agents, even if it isn't detected (repeatable)",
    force: "Overwrite skill folders and agent files that skillpack doesn't own or that were edited",
    "dry-run": "Show what would change and write nothing",
    yes: "Don't ask (sync never asks)",
    json: "Print the result as JSON",
  },
  async run(ctx) {
    const flag = strings(ctx.values.harness).flatMap((h) => h.split(",")).map((h) => h.trim()).filter(Boolean);
    for (const h of flag) if (!isHarness(h)) throw new UsageError(`unknown harness "${h}" (use ${HARNESSES.join(", ")})`);
    const dryRun = ctx.values["dry-run"] === true;
    const json = ctx.values.json === true;
    const projectDir = resolve(ctx.cwd);
    const s = createStyle(ctx.color);
    const out = (t: string): void => ctx.stdout(t);
    const fail = (message: string, extra: Record<string, unknown> = {}): number => {
      if (json) out(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + "\n");
      else ctx.stderr(`skillpack sync: ${message}\n`);
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
      if (ctx.positionals.length > 0) {
        keys = [...new Set(ctx.positionals.map((r) => resolvePackRef(config, r, (k) => deriveScope(projectDir, config, lock, k))))];
      }
      const detected = ctx.detectHarnesses ? ctx.detectHarnesses(projectDir) : detectHarnesses(systemDetectEnv(projectDir, ctx.env));
      const { targets, statuses } = await prepareTargets({
        config,
        lock,
        detected,
        keys,
        lockedOnly: true,
        harnessFlag: flag as Harness[],
        env: ctx.env,
        cliVersion: CLI_VERSION,
      });
      const plan = await planProjectInstall({
        projectDir,
        cliVersion: CLI_VERSION,
        config,
        lock,
        targets,
        force: ctx.values.force === true,
        restoreEdited: false,
        blockOnAgents: false,
        exactExclude: true,
        env: ctx.env,
      });

      if (plan.conflicts.length > 0 || plan.blocked.length > 0) {
        if (json) out(JSON.stringify({ ok: false, error: plan.conflicts.length ? "conflict" : "blocked", conflicts: plan.conflicts, blocked: plan.blocked }, null, 2) + "\n");
        else {
          for (const c of plan.conflicts) ctx.stderr(`skillpack sync: ${c}\n`);
          if (plan.blocked.length > 0) {
            ctx.stderr("skillpack sync: these skill folders are not owned by skillpack or were edited, so they were kept:\n");
            for (const b of plan.blocked) ctx.stderr(`  ${b.path} (${why(b)})\n`);
            ctx.stderr("Nothing was written. Re-run with --force to overwrite them.\n");
          } else ctx.stderr("Nothing was written.\n");
        }
        return 1;
      }

      const changes = describeChanges(projectDir, plan.ops);
      if (!dryRun && plan.ops.length > 0) applyChanges(projectDir, plan.ops);
      const orphans = ctx.positionals.length === 0 ? removedKeys(config, lock) : [];

      if (json) {
        out(
          JSON.stringify(
            {
              ok: true,
              dryRun,
              packs: statuses.map((st, i) => ({
                source: st.key,
                name: st.name,
                ref: st.ref,
                commit: st.commit,
                skippedHarnesses: st.skippedHarnesses,
                agentFiles: plan.targets[i]!.agentPaths,
              })),
              skills: plan.skillActions,
              keptAgents: plan.keptAgents,
              warnings: plan.targets.flatMap((t) => t.warnings),
              changes,
              lockChanged: plan.lockChanged,
              commit: plan.commitPaths,
              lockOnly: orphans,
              outsideRepo: plan.outsideRepo,
            },
            null,
            2,
          ) + "\n",
        );
        return 0;
      }

      const touched = new Set(plan.ops.map((o) => o.path));
      const changedAgents = plan.targets.map((t) => t.agentPaths.filter((p) => touched.has(p)));
      for (const [i, st] of statuses.entries()) {
        out(`${s.green("✔")} ${st.name} ${formatLockedRef(st.ref, st.commit)} (synced)\n`);
        for (const h of HARNESSES) {
          const ids = changedAgents[i]!.filter((p) => harnessOfPath(p) === h).map((p) => p.split("/").pop()!.replace(/\.(md|toml)$/, ""));
          if (ids.length > 0) out(s.dim(`    agents (${HARNESS_INFO[h].displayName}): ${ids.join(", ")}`) + "\n");
        }
        for (const h of st.skippedHarnesses) out(s.dim(`    ${h} not detected; left its agents alone (use -a ${h} to sync them)`) + "\n");
      }
      const deleted = plan.ops.filter((o) => o.type === "delete-file" && o.label === "agent").map((o) => o.path);
      if (plan.skillActions.length > 0 || deleted.length > 0) {
        out(`\n${s.bold("Changes")}\n`);
        for (const a of plan.skillActions) out(`  ${a.action.padEnd(9)} ${a.path}\n`);
        for (const p of deleted) out(`  ${"removed".padEnd(9)} ${p}\n`);
      }
      const shown = plan.targets.filter((_, i) => changedAgents[i]!.length > 0);
      const changedHarnesses = new Set(changedAgents.flat().map(harnessOfPath));
      const warnings = formatAgentWarnings(shown.flatMap((t) => t.warnings).filter((w) => changedHarnesses.has(w.harness)), s);
      const notes = plan.targets.flatMap((t, i) => (changedAgents[i]!.length === 0 ? [] : t.notes).map((n) => `  ${s.yellow("model".padEnd(11))} ${statuses[i]!.name}: ${n}\n`));
      const kept = plan.keptAgents.map((b) => `  ${s.yellow("kept".padEnd(11))} ${b.path} (${why(b)}; not ${b.action === "delete" ? "deleted" : "overwritten"}); use --force\n`);
      if (warnings || notes.length > 0 || kept.length > 0) out(`\n${s.bold("Warnings")}\n${warnings}${notes.join("")}${kept.join("")}`);
      for (const k of orphans) out(s.dim(`\nnote: ${k} is in the lock file but not in skillpack.json; run skillpack install to clean it up`) + "\n");

      if (dryRun) out(`\n${s.bold("Would change")}\n${changes.length > 0 ? formatChangeDescriptions(changes) : "  (nothing)\n"}`);
      if (plan.outsideRepo) {
        out(`\nNot a git repository. Keep these generated files out of version control:\n${plan.excludePaths.map((p) => `  /${p}\n`).join("")}`);
      }
      out("\n");
      if (plan.ops.length === 0) out(s.green("✔ already in sync; nothing written") + "\n");
      else out(s.green(dryRun ? "✔ dry run: nothing written" : `✔ synced ${plural(statuses.length, "pack")}`) + "\n");
      if (!dryRun && plan.commitPaths.length > 0) out(`Commit: ${plan.commitPaths.join(", ")}\n`);
      return 0;
    } catch (e) {
      if (e instanceof PackError) {
        if (json) out(JSON.stringify({ ok: false, error: e.message, diagnostics: e.diagnostics }, null, 2) + "\n");
        else {
          out(formatDiagnostics(e.diagnostics, s));
          ctx.stderr(`skillpack sync: ${e.message}; nothing written\n`);
        }
        return 1;
      }
      if (e instanceof InstallError || e instanceof PackRefError || e instanceof GitError || e instanceof VersionError || e instanceof SourceError) {
        return fail(e.message);
      }
      throw e;
    }
  },
};
