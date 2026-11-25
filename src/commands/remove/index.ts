import { resolve } from "node:path";
import { PackError } from "../../core/install/fetch-pack.js";
import { planRemove, resolveRemoveTarget, RemoveError, type RemoveTarget } from "../../core/install/remove.js";
import { detectHarnesses, systemDetectEnv } from "../../core/harness-detect.js";
import { GitError } from "../../core/git/index.js";
import { isHarness, type Harness } from "../../core/harness.js";
import { createStyle, formatDiagnostics, plural } from "../../core/output.js";
import {
  applyChanges, describeChanges, formatChangeDescriptions, readConfig, readLock, PackRefError, type BlockedItem,
} from "../../core/project/index.js";
import { CLI_VERSION } from "../../core/version.js";
import { VersionError } from "../../core/source/versions.js";
import { UsageError, type Command } from "../types.js";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");

const describeTarget = (t: RemoveTarget): string =>
  t.kind === "pack" ? `pack ${t.key}` : t.kind === "skill" ? `skill ${t.folder} of ${t.key}` : `agent ${t.agent} of ${t.key}`;

const why = (b: BlockedItem): string => (b.reason === "edited" ? "edited since install" : b.reason === "foreign" ? "not installed by skillpack" : "installed by another pack");

export const remove: Command = {
  name: "remove",
  summary: "Remove packs, skills or agents from the project",
  usage: "skillpack remove <pack|skill|agent>... [-a <harness>]... [--force] [--dry-run] [-y] [--json]",
  options: {
    harness: { type: "string", short: "a", multiple: true },
    force: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    json: { type: "boolean" },
  },
  optionHelp: {
    harness: "For agents: remove the binding only in this harness (default: all of the pack's)",
    force: "Also remove skill folders and agent files that were edited since install",
    "dry-run": "Show what would change and write nothing",
    yes: "Don't ask (remove never asks)",
    json: "Print the result as JSON",
  },
  async run(ctx) {
    if (ctx.positionals.length === 0) throw new UsageError("expected a pack, skill or agent to remove");
    const harnesses = strings(ctx.values.harness).flatMap((h) => h.split(",")).map((h) => h.trim()).filter(Boolean);
    for (const h of harnesses) if (!isHarness(h)) throw new UsageError(`unknown harness "${h}"`);
    const dryRun = ctx.values["dry-run"] === true;
    const json = ctx.values.json === true;
    const force = ctx.values.force === true;
    const projectDir = resolve(ctx.cwd);
    const s = createStyle(ctx.color);
    const out = (t: string): void => ctx.stdout(t);
    const fail = (message: string, extra: Record<string, unknown> = {}): number => {
      if (json) out(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + "\n");
      else ctx.stderr(`skillpack remove: ${message}\n`);
      return 1;
    };

    const cfgState = readConfig(projectDir);
    if (cfgState.status === "missing") return fail("no skillpack.json; there is nothing to remove");
    if (cfgState.status === "invalid") return fail(cfgState.errors.join("\n"));
    const lockState = readLock(projectDir);
    if (lockState.status === "invalid") return fail(lockState.errors.join("\n"));
    const config = cfgState.value;
    const lock = lockState.status === "ok" ? lockState.value : null;

    try {
      const targets = ctx.positionals.map((ref) => resolveRemoveTarget(ref, { projectDir, config, lock }));
      const detected = ctx.detectHarnesses ? ctx.detectHarnesses(projectDir) : detectHarnesses(systemDetectEnv(projectDir, ctx.env));
      const plan = await planRemove({
        projectDir,
        cliVersion: CLI_VERSION,
        config,
        lock,
        targets,
        harnesses: harnesses as Harness[],
        detected,
        force,
        env: ctx.env,
      });

      if (plan.conflicts.length > 0 || plan.blocked.length > 0) {
        if (json) out(JSON.stringify({ ok: false, error: plan.conflicts.length ? "conflict" : "blocked", conflicts: plan.conflicts, blocked: plan.blocked }, null, 2) + "\n");
        else {
          for (const c of plan.conflicts) ctx.stderr(`skillpack remove: ${c}\n`);
          if (plan.blocked.length > 0) {
            ctx.stderr("skillpack remove: these files were edited since install, so they were kept:\n");
            for (const b of plan.blocked) ctx.stderr(`  ${b.path} (${why(b)})\n`);
            ctx.stderr("Nothing was removed. Re-run with --force to remove them too.\n");
          } else ctx.stderr("Nothing was removed.\n");
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
              targets,
              removedSkills: plan.deletedSkills,
              removedAgents: plan.deletedAgents,
              fetched: plan.fetched,
              changes,
              commit: plan.commitPaths,
            },
            null,
            2,
          ) + "\n",
        );
        return 0;
      }

      for (const t of targets) out(`${s.red("-")} ${describeTarget(t)}\n`);
      if (plan.fetched.length > 0) out(s.dim(`  fetched ${plan.fetched.join(", ")} at the locked commit to re-render skills`) + "\n");
      out(`\n${s.bold(dryRun ? "Would change" : "Changes")}\n${changes.length > 0 ? formatChangeDescriptions(changes) : "  (nothing)\n"}`);
      out("\n" + s.green(dryRun ? "✔ dry run: nothing written" : `✔ removed ${plural(targets.length, "item")}`) + "\n");
      if (!dryRun && plan.commitPaths.length > 0) out(`Commit: ${plan.commitPaths.join(", ")}\n`);
      return 0;
    } catch (e) {
      if (e instanceof RemoveError || e instanceof PackRefError || e instanceof GitError || e instanceof VersionError) return fail(e.message);
      if (e instanceof PackError) {
        out(formatDiagnostics(e.diagnostics, s));
        return fail(`${e.message}; nothing removed`);
      }
      throw e;
    }
  },
};
