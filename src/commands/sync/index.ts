import { resolve } from "node:path";
import { GitError } from "../../core/git/index.js";
import { detectHarnesses, systemDetectEnv } from "../../core/harness-detect.js";
import { HARNESSES, isHarness, type Harness } from "../../core/harness.js";
import { PackError } from "../../core/install/fetch-pack.js";
import { removedKeys } from "../../core/install/from-config.js";
import { resolveTargetModels } from "../../core/install/models.js";
import { createSystemModelSource } from "../../core/models/available.js";
import { formatBlocked, formatSyncReport, planSync, prepareSync } from "../../core/install/sync.js";
import { InstallError } from "../../core/install/select.js";
import { createStyle, formatDiagnostics } from "../../core/output.js";
import {
  PackRefError, applyChanges, deriveScope, describeChanges, readConfig, readLock, resolvePackRef,
} from "../../core/project/index.js";
import { SourceError } from "../../core/source/parse.js";
import { VersionError } from "../../core/source/versions.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type Command } from "../types.js";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
export const sync: Command = {
  name: "sync",
  summary: "Regenerate skills and agents from skillpack.json at the locked commits",
  usage: "skillpack sync [pack]... [-a <harness>]... [--force] [--strict] [--dry-run] [-y] [--json]",
  options: {
    harness: { type: "string", short: "a", multiple: true },
    force: { type: "boolean" },
    strict: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    json: { type: "boolean" },
  },
  optionHelp: {
    harness: "Touch only this harness's agents, even if it isn't detected (repeatable)",
    force: "Overwrite skill folders and agent files that skillpack doesn't own or that were edited",
    strict: "Fail when a model can't be matched or verified (instead of generating the agent without one)",
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
      const { targets, statuses } = await prepareSync({ config, lock, keys, detected, harnessFlag: flag as Harness[], env: ctx.env, cliVersion: CLI_VERSION });
      const modelResult = await resolveTargetModels({ projectDir, targets, source: ctx.models ?? createSystemModelSource(ctx.env), strict: ctx.values.strict === true });
      if (modelResult.failures.length > 0) return fail(`model problems (--strict); nothing written:\n  ${modelResult.failures.join("\n  ")}`);
      const plan = await planSync({ projectDir, cliVersion: CLI_VERSION, config, lock, targets, force: ctx.values.force === true, env: ctx.env, ...(modelResult.models ? { models: modelResult.models } : {}) });

      if (plan.conflicts.length > 0 || plan.blocked.length > 0) {
        if (json) out(JSON.stringify({ ok: false, error: plan.conflicts.length ? "conflict" : "blocked", conflicts: plan.conflicts, blocked: plan.blocked }, null, 2) + "\n");
        else ctx.stderr(formatBlocked("sync", plan));
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

      out(formatSyncReport({ plan, statuses, changes, dryRun, orphans, verb: "synced", s }));
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
