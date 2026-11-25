import { resolve } from "node:path";
import { isCI } from "../../core/ci.js";
import { GitError } from "../../core/git/index.js";
import { detectHarnesses, systemDetectEnv } from "../../core/harness-detect.js";
import { HARNESS_INFO, HARNESSES, type Harness } from "../../core/harness.js";
import { PackError } from "../../core/install/fetch-pack.js";
import { frozenSkillProblems, lockfileProblems, packsToRemove, prepareTargets } from "../../core/install/from-config.js";
import { planProjectInstall } from "../../core/install/project.js";
import { InstallError } from "../../core/install/select.js";
import { createStyle, formatAgentWarnings, formatDiagnostics, plural } from "../../core/output.js";
import {
  applyChanges, describeChanges, formatChangeDescriptions, readConfig, readLock, type BlockedItem,
} from "../../core/project/index.js";
import { SourceError } from "../../core/source/parse.js";
import { VersionError } from "../../core/source/versions.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type Command } from "../types.js";

const SIGN = { locked: "✔", "re-resolved": "↻", resolved: "↻" } as const;

function whyBlocked(b: BlockedItem): string {
  return b.reason === "foreign" ? "not installed by skillpack" : b.reason === "edited" ? "edited since install" : "installed by another pack";
}

const harnessOfPath = (p: string): Harness | null => HARNESSES.find((h) => p.startsWith(`.${h}/`)) ?? null;

export const install: Command = {
  name: "install",
  summary: "Make the project match skillpack.json and the lock file",
  usage: "skillpack install [--frozen-lockfile | --no-frozen-lockfile] [--force] [--dry-run] [-y] [--json]",
  options: {
    "frozen-lockfile": { type: "boolean" },
    "no-frozen-lockfile": { type: "boolean" },
    force: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    json: { type: "boolean" },
  },
  optionHelp: {
    "frozen-lockfile": "Only check the lock file and skills; fail without writing if they're out of date (default when CI is set)",
    "no-frozen-lockfile": "Don't check only, even when CI is set",
    force: "Overwrite skill folders and agent files that skillpack doesn't own or that were edited",
    "dry-run": "Show what would change and write nothing",
    yes: "Don't ask (install never asks)",
    json: "Print the result as JSON",
  },
  async run(ctx) {
    if (ctx.positionals.length > 0) throw new UsageError("install takes no arguments; add packs with skillpack add");
    if (ctx.values["frozen-lockfile"] === true && ctx.values["no-frozen-lockfile"] === true) {
      throw new UsageError("--frozen-lockfile and --no-frozen-lockfile can't be combined");
    }
    const frozen = ctx.values["no-frozen-lockfile"] === true ? false : ctx.values["frozen-lockfile"] === true || isCI(ctx.env);
    const dryRun = ctx.values["dry-run"] === true;
    const json = ctx.values.json === true;
    const projectDir = resolve(ctx.cwd);
    const s = createStyle(ctx.color);
    const out = (t: string): void => ctx.stdout(t);
    const fail = (message: string, extra: Record<string, unknown> = {}): number => {
      if (json) out(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + "\n");
      else ctx.stderr(`skillpack install: ${message}\n`);
      return 1;
    };

    const cfgState = readConfig(projectDir);
    if (cfgState.status === "missing") return fail("no skillpack.json; add a pack with skillpack add");
    if (cfgState.status === "invalid") return fail(cfgState.errors.join("\n"));
    const lockState = readLock(projectDir);
    if (lockState.status === "invalid") return fail(lockState.errors.join("\n"));
    const config = cfgState.value;
    const lock = lockState.status === "ok" ? lockState.value : null;

    const frozenFail = (problems: string[]): number => {
      if (json) out(JSON.stringify({ ok: false, frozen: true, problems }, null, 2) + "\n");
      else {
        ctx.stderr("skillpack install: the lock file or the skills are out of date:\n");
        for (const p of problems) ctx.stderr(`  ${p}\n`);
        ctx.stderr("Nothing was written. Run skillpack install --no-frozen-lockfile to update them.\n");
      }
      return 1;
    };

    if (frozen) {
      const early = lockfileProblems(config, lock);
      if (early.length > 0) return frozenFail(early);
    }

    try {
      const detected = frozen ? [] : ctx.detectHarnesses ? ctx.detectHarnesses(projectDir) : detectHarnesses(systemDetectEnv(projectDir, ctx.env));
      const { targets, statuses } = await prepareTargets({
        config,
        lock,
        detected,
        noAgents: frozen,
        env: ctx.env,
        cliVersion: CLI_VERSION,
      });
      const removeKeys = packsToRemove(projectDir, config, lock);
      const plan = await planProjectInstall({
        projectDir,
        cliVersion: CLI_VERSION,
        config,
        lock,
        targets,
        removeKeys,
        force: ctx.values.force === true,
        restoreEdited: true,
        blockOnAgents: false,
        env: ctx.env,
      });

      if (frozen) {
        const problems = frozenSkillProblems(plan, lock);
        if (problems.length > 0) return frozenFail(problems);
        if (json) out(JSON.stringify({ ok: true, frozen: true, upToDate: true }, null, 2) + "\n");
        else out(s.green("✔ lockfile and skills are up to date") + "\n");
        return 0;
      }

      if (plan.conflicts.length > 0 || plan.blocked.length > 0) {
        if (json) out(JSON.stringify({ ok: false, error: plan.conflicts.length ? "conflict" : "blocked", conflicts: plan.conflicts, blocked: plan.blocked }, null, 2) + "\n");
        else {
          for (const c of plan.conflicts) ctx.stderr(`skillpack install: ${c}\n`);
          if (plan.blocked.length > 0) {
            ctx.stderr("skillpack install: these skill folders are not owned by skillpack, so they were kept:\n");
            for (const b of plan.blocked) ctx.stderr(`  ${b.path} (${whyBlocked(b)})\n`);
            ctx.stderr("Nothing was written. Re-run with --force to overwrite them.\n");
          } else ctx.stderr("Nothing was written.\n");
        }
        return 1;
      }

      const changes = describeChanges(projectDir, plan.ops);
      if (!dryRun && plan.ops.length > 0) applyChanges(projectDir, plan.ops);

      if (json) {
        out(
          JSON.stringify(
            {
              ok: true,
              dryRun,
              packs: statuses.map((st, i) => ({
                source: st.key,
                name: st.name,
                status: st.kind,
                version: st.tag,
                commit: st.commit,
                requested: st.requested,
                skippedHarnesses: st.skippedHarnesses,
                agentFiles: plan.targets[i]!.agentPaths,
              })),
              removed: plan.removed,
              skills: plan.skillActions,
              keptAgents: plan.keptAgents,
              warnings: plan.targets.flatMap((t) => t.warnings),
              notes: plan.targets.flatMap((t) => t.notes),
              changes,
              lockChanged: plan.lockChanged,
              excludePaths: plan.excludePaths,
              outsideRepo: plan.outsideRepo,
            },
            null,
            2,
          ) + "\n",
        );
        return 0;
      }

      const touched = new Set(plan.ops.map((op) => op.path));
      const changedAgents = plan.targets.map((t) => t.agentPaths.filter((p) => touched.has(p)));
      for (const [i, st] of statuses.entries()) {
        const v = st.tag ?? `${st.requested}@${st.commit.slice(0, 7)}`;
        const how = st.kind === "locked" ? "(locked)" : st.kind === "re-resolved" ? `(re-resolved from ${st.requested})` : `(resolved from ${st.requested}; not in the lock file)`;
        out(`${st.kind === "locked" ? s.green(SIGN.locked) : s.yellow(SIGN[st.kind])} ${st.name} ${v} ${how}\n`);
        const t = plan.targets[i]!;
        for (const h of HARNESSES) {
          const ids = changedAgents[i]!.filter((p) => harnessOfPath(p) === h).map((p) => p.split("/").pop()!.replace(/\.(md|toml)$/, ""));
          if (ids.length > 0) out(s.dim(`    agents (${HARNESS_INFO[h].displayName}): ${ids.join(", ")}`) + "\n");
        }
        for (const h of st.skippedHarnesses) out(s.dim(`    ${h} not detected; skipped agents for it`) + "\n");
      }
      for (const r of plan.removed) {
        out(`${s.red("-")} ${r.key} removed\n`);
        for (const p of r.editedSkills) out(s.yellow(`    ${p} had local edits and was deleted (recover it from git if needed)`) + "\n");
      }
      const verb = { added: "added", restored: "restored", updated: "updated", removed: "removed" } as const;
      if (plan.skillActions.length > 0) {
        out(`\n${s.bold("Skills")}\n`);
        for (const a of plan.skillActions) out(`  ${verb[a.action].padEnd(9)} ${a.path}${a.edited ? s.yellow(" (had local edits)") : ""}\n`);
      }

      const shown = plan.targets.filter((_, i) => changedAgents[i]!.length > 0);
      const warnings = formatAgentWarnings(shown.flatMap((t) => t.warnings), s);
      const notes = plan.targets.flatMap((t, i) => (changedAgents[i]!.length === 0 ? [] : t.notes).map((n) => `  ${s.yellow("model".padEnd(11))} ${statuses[i]!.name}: ${n}\n`));
      const kept = plan.keptAgents.map((b) => `  ${s.yellow("kept".padEnd(11))} ${b.path} (${whyBlocked(b)}${b.action === "delete" ? "; not deleted" : "; not overwritten"}); use --force\n`);
      if (warnings || notes.length > 0 || kept.length > 0) out(`\n${s.bold("Warnings")}\n${warnings}${notes.join("")}${kept.join("")}`);

      if (dryRun) {
        out(`\n${s.bold("Would change")}\n${changes.length > 0 ? formatChangeDescriptions(changes) : "  (nothing)\n"}`);
      }
      if (plan.outsideRepo) {
        out(`\nNot a git repository. Keep these generated files out of version control:\n${plan.excludePaths.map((p) => `  /${p}\n`).join("")}`);
      }
      out("\n");
      if (plan.ops.length === 0) out(s.green(`✔ already up to date (${plural(statuses.length, "pack")}); nothing written`) + "\n");
      else out(s.green(dryRun ? "✔ dry run: nothing written" : `✔ installed ${plural(statuses.length, "pack")}`) + "\n");
      if (!dryRun && plan.commitPaths.length > 0) out(`Commit: ${plan.commitPaths.join(", ")}\n`);
      return 0;
    } catch (e) {
      if (e instanceof PackError) {
        if (json) out(JSON.stringify({ ok: false, error: e.message, diagnostics: e.diagnostics }, null, 2) + "\n");
        else {
          out(formatDiagnostics(e.diagnostics, s));
          ctx.stderr(`skillpack install: ${e.message}; nothing written\n`);
        }
        return 1;
      }
      if (e instanceof GitError || e instanceof VersionError || e instanceof InstallError || e instanceof SourceError) return fail(e.message);
      throw e;
    }
  },
};
