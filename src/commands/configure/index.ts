import { resolve } from "node:path";
import { GitError } from "../../core/git/index.js";
import { detectHarnesses, systemDetectEnv } from "../../core/harness-detect.js";
import { HARNESSES, HARNESS_INFO, isHarness, type Harness } from "../../core/harness.js";
import { modelRequests, resolveTargetModels } from "../../core/install/models.js";
import { describeModels, formatModelRows } from "../../core/install/models-view.js";
import { createSystemModelSource } from "../../core/models/available.js";
import { promptModelMappings } from "../../core/prompts/models.js";
import { bindingWarnings, computePackConfig, formatBindingChange, resolveAgentRefs } from "../../core/install/configure.js";
import { PackError } from "../../core/install/fetch-pack.js";
import { InstallError } from "../../core/install/select.js";
import { formatBlocked, formatSyncReport, planSync, prepareSync } from "../../core/install/sync.js";
import { toKebab } from "../../core/names.js";
import { createStyle, formatDiagnostics } from "../../core/output.js";
import { CancelledError } from "../../core/prompts/index.js";
import {
  PackRefError, applyChanges, deriveScope, describeChanges, emptyModels, readConfig, readLock, readModels, resolvePackRef,
  type PackConfig, type SelectionConfig,
} from "../../core/project/index.js";
import { SourceError } from "../../core/source/parse.js";
import { VersionError } from "../../core/source/versions.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type Command } from "../types.js";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");

function bindingsTable(cfg: PackConfig, agents: string[]): string {
  const head = ["agent", ...cfg.harnesses.map((h) => HARNESS_INFO[h].displayName)];
  const rows = agents.map((a) => [a, ...cfg.harnesses.map((h) => cfg.agents[a]?.[h] ?? "generate (default)")]);
  const w = head.map((_, i) => Math.max(...[head, ...rows].map((r) => r[i]!.length)));
  return [head, ...rows].map((r) => `  ${r.map((c, j) => c.padEnd(w[j]!)).join("  ").trimEnd()}\n`).join("");
}

export const configure: Command = {
  name: "configure",
  summary: "Change how a pack's agents are filled (generate, a built-in agent, or none)",
  usage:
    "skillpack configure [pack] [agent]... [-a <harness>]... [--bind <agent>[.<harness>]=<binding>]... [--show] [--models] [--model <name>=<harness>:<model>]... [--strict] [--force] [--dry-run] [-y] [--json]",
  options: {
    harness: { type: "string", short: "a", multiple: true },
    bind: { type: "string", multiple: true },
    show: { type: "boolean" },
    models: { type: "boolean" },
    model: { type: "string", multiple: true },
    strict: { type: "boolean" },
    force: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    json: { type: "boolean" },
  },
  optionHelp: {
    harness: "Only these harnesses (repeatable)",
    bind: "Binding: <agent>[.<harness>]=generate|none|existing:<id> (repeatable); skips the prompts",
    show: "Print the current bindings, models and warnings; changes nothing",
    models: "Review the model mapping of each model the pack asks for (interactive)",
    model: "Set a model: <name>=<harness>:<model>, e.g. sonnet-5.5=opencode:github-copilot/claude-sonnet-5.5 (repeatable)",
    strict: "Fail when a model can't be matched or verified (instead of generating the agent without one)",
    force: "Overwrite skill folders and agent files that skillpack doesn't own or that were edited",
    "dry-run": "Show what would change and write nothing",
    yes: "Don't ask: make every binding explicit and change nothing else",
    json: "Print the result as JSON",
  },
  async run(ctx) {
    const flag = strings(ctx.values.harness).flatMap((h) => h.split(",")).map((h) => h.trim()).filter(Boolean);
    for (const h of flag) if (!isHarness(h)) throw new UsageError(`unknown harness "${h}" (use ${HARNESSES.join(", ")})`);
    const binds = strings(ctx.values.bind);
    const modelSpecs = strings(ctx.values.model);
    const modelSets = modelSpecs.map((spec) => {
      const m = /^([^=\s]+)=(opencode|codex):(\S+)$/.exec(spec);
      if (!m) throw new UsageError(`invalid --model "${spec}"; use <name>=<harness>:<model>, e.g. sonnet-5.5=opencode:provider/model`);
      if (m[2] === "opencode" && !/^[^/\s#]+\/[^\s#]+$/.test(m[3]!)) throw new UsageError(`--model ${spec}: an OpenCode model is provider/model, without a variant`);
      return { name: m[1]!, harness: m[2] as Harness, concrete: m[3]! };
    });
    const modelsFlag = ctx.values.models === true;
    const modelMode = modelsFlag || modelSets.length > 0;
    const show = ctx.values.show === true;
    const dryRun = ctx.values["dry-run"] === true;
    const json = ctx.values.json === true;
    const yes = ctx.values.yes === true;
    const projectDir = resolve(ctx.cwd);
    const s = createStyle(ctx.color);
    const out = (t: string): void => ctx.stdout(t);
    const fail = (message: string, extra: Record<string, unknown> = {}): number => {
      if (json) out(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + "\n");
      else ctx.stderr(`skillpack configure: ${message}\n`);
      return 1;
    };

    const cfgState = readConfig(projectDir);
    if (cfgState.status === "missing") return fail("no skillpack.json; add a pack with skillpack add");
    if (cfgState.status === "invalid") return fail(cfgState.errors.join("\n"));
    const lockState = readLock(projectDir);
    if (lockState.status === "invalid") return fail(lockState.errors.join("\n"));
    const config: SelectionConfig = cfgState.value;
    const lock = lockState.status === "ok" ? lockState.value : null;
    const scopesOf = (k: string) => deriveScope(projectDir, config, lock, k);
    const keys = Object.keys(config.packs);
    if (keys.length === 0) return fail("no packs configured; add one with skillpack add");

    const prompts = ctx.interactive && !yes && binds.length === 0 && !show && !modelMode ? ctx.prompts : undefined;
    const modelPrompts = ctx.interactive && !yes && !show ? ctx.prompts : undefined;
    const source = ctx.models ?? createSystemModelSource(ctx.env);

    try {
      // Which pack, and which agents: `[pack] [agent...]`; the pack may be left out when only one is configured.
      let agentRefs = [...ctx.positionals];
      let key: string | null = null;
      if (agentRefs.length > 0) {
        try {
          key = resolvePackRef(config, agentRefs[0]!, scopesOf);
          agentRefs = agentRefs.slice(1);
        } catch (e) {
          if (!(e instanceof PackRefError)) throw e;
          if (keys.length > 1) throw e;
        }
      }
      if (key === null && keys.length === 1) key = keys[0]!;

      if (show) {
        const shown = key ? [key] : keys;
        const view = await Promise.all(shown.map(async (k) => {
          const cfg = config.packs[k]!;
          const known = Object.keys(cfg.agents);
          for (const r of agentRefs) {
            if (!known.some((a) => a === r || toKebab(a) === toKebab(r))) throw new InstallError(`skillpack.json has no agent "${r}" for ${k} (agents: ${known.join(", ")})`, true);
          }
          const agents = agentRefs.length > 0 ? known.filter((a) => agentRefs.some((r) => toKebab(a) === toKebab(r))) : known;
          // The models the pack asks for need its source: fetch it read-only at the locked commit; without it only the mappings in the models file are listed.
          let requests = null;
          let note = "";
          try {
            const { targets } = await prepareSync({ config, lock, keys: [k], detected: [], harnessFlag: cfg.harnesses, env: ctx.env, cliVersion: CLI_VERSION });
            requests = modelRequests(targets[0]!);
          } catch (e) {
            note = `  (the pack couldn't be read at its locked commit, so only the mappings in the models file are shown: ${(e as Error).message.split("\n")[0]})\n`;
          }
          const modelsState = readModels(projectDir);
          const modelRows = await describeModels({ packKey: k, requests, models: modelsState.status === "ok" ? modelsState.value : emptyModels(), source });
          return { key: k, scope: scopesOf(k).best, cfg, agents, warnings: bindingWarnings(cfg), modelRows, note };
        }));
        if (json) {
          out(JSON.stringify({
            packs: view.map((v) => ({
              source: v.key, scope: v.scope, harnesses: v.cfg.harnesses,
              bindings: Object.fromEntries(v.agents.map((a) => [a, Object.fromEntries(v.cfg.harnesses.map((h) => [h, v.cfg.agents[a]?.[h] ?? "generate"]))])),
              warnings: v.warnings, models: v.modelRows,
            })),
          }, null, 2) + "\n");
          return 0;
        }
        out(view.map((v) =>
          `${s.bold(v.scope ?? "(scope unknown)")}  ${s.dim(v.key)}\n  harnesses  ${v.cfg.harnesses.map((h) => HARNESS_INFO[h].displayName).join(", ")}\n` +
          (v.agents.length > 0 ? bindingsTable(v.cfg, v.agents) : "  (no agent bindings)\n") +
          `  models\n${v.note}${formatModelRows(v.modelRows, (h) => HARNESS_INFO[h].displayName)}` +
          v.warnings.map((w) => `  ${s.yellow("warning")} ${w}\n`).join(""),
        ).join("\n"));
        return 0;
      }

      if (key === null) {
        if (prompts) {
          key = await prompts.select<string>({
            message: "Which pack?",
            options: keys.map((k) => ({ value: k, label: scopesOf(k).best ?? k, hint: k })),
          });
        } else {
          return fail(`several packs are configured; name one: ${keys.map((k) => `${scopesOf(k).best ?? k} (${k})`).join(", ")}`);
        }
      }
      const cfg = config.packs[key]!;
      if (modelsFlag && !modelPrompts) throw new UsageError("--models needs an interactive terminal; use --model <name>=<harness>:<model>");
      if (!prompts && binds.length === 0 && !yes && !modelMode) {
        throw new UsageError("interactive terminal required; use --bind <agent>[.<harness>]=<binding> (or -y)");
      }

      const detected = ctx.detectHarnesses ? ctx.detectHarnesses(projectDir) : detectHarnesses(systemDetectEnv(projectDir, ctx.env));
      const { targets, statuses } = await prepareSync({ config, lock, keys: [key], detected, harnessFlag: flag as Harness[], env: ctx.env, cliVersion: CLI_VERSION });
      const target = targets[0]!;
      resolveAgentRefs(agentRefs, target.pack.agents.map((a) => a.name), target.scope);

      const { packConfig, changes: bindingChanges } = await computePackConfig({
        pack: target.pack,
        cfg,
        scope: target.scope,
        agentRefs,
        harnessFlag: flag as Harness[],
        mode: binds.length > 0 ? { kind: "binds", specs: binds } : prompts ? { kind: "prompt", prompts } : { kind: "defaults" },
      });
      target.packConfig = packConfig;

      // Models (R-REQ-2..4): mappings set with --model or --models first, then the usual matching for anything unmapped.
      const requestedNames = new Set(target.pack.agents.flatMap((a) => a.modelNames));
      let sets = modelSets.map((m) => ({ ...m, key }));
      for (const m of sets) {
        if (!requestedNames.has(m.name)) throw new UsageError(`--model: the pack's agents don't ask for "${m.name}" (they ask for: ${[...requestedNames].join(", ") || "no models"})`);
        if (!packConfig.harnesses.includes(m.harness)) throw new UsageError(`--model: the pack isn't installed for ${m.harness}`);
      }
      if (modelsFlag) {
        const state = readModels(projectDir);
        const asked = await promptModelMappings({
          packKey: key,
          requests: modelRequests(target),
          models: state.status === "ok" ? state.value : emptyModels(),
          source,
          prompts: modelPrompts!,
        });
        sets = [...sets, ...asked.map((m) => ({ ...m, key }))];
      }
      const modelResult = await resolveTargetModels({
        projectDir,
        targets,
        source,
        prompts: modelPrompts,
        strict: ctx.values.strict === true,
        set: sets,
      });
      if (modelResult.failures.length > 0) return fail(`model problems (--strict); nothing written:\n  ${modelResult.failures.join("\n  ")}`);

      if (bindingChanges.length === 0 && !modelResult.changed) {
        if (json) out(JSON.stringify({ ok: true, changed: false, changes: [] }, null, 2) + "\n");
        else out("nothing to configure\n");
        return 0;
      }

      const newConfig: SelectionConfig = { ...config, packs: { ...config.packs, [key]: packConfig } };
      const plan = await planSync({ projectDir, cliVersion: CLI_VERSION, config: newConfig, lock, targets, force: ctx.values.force === true, writeConfig: true, env: ctx.env, ...(modelResult.models ? { models: modelResult.models } : {}) });
      if (plan.conflicts.length > 0 || plan.blocked.length > 0) {
        if (json) out(JSON.stringify({ ok: false, error: plan.conflicts.length ? "conflict" : "blocked", conflicts: plan.conflicts, blocked: plan.blocked }, null, 2) + "\n");
        else ctx.stderr(formatBlocked("configure", plan));
        return 1;
      }

      const changes = describeChanges(projectDir, plan.ops);
      if (!dryRun && plan.ops.length > 0) applyChanges(projectDir, plan.ops);

      if (json) {
        out(JSON.stringify({
          ok: true, dryRun, changed: true, source: key,
          bindings: bindingChanges, models: modelResult.mappingChanges, skills: plan.skillActions, keptAgents: plan.keptAgents,
          changes, commit: plan.commitPaths, warnings: plan.targets.flatMap((t) => t.warnings),
        }, null, 2) + "\n");
        return 0;
      }
      out(`${s.bold(dryRun ? "Would configure" : "Configured")} ${key}\n`);
      for (const c of bindingChanges) out(`  ${formatBindingChange(c)}\n`);
      for (const c of modelResult.mappingChanges) out(`  model ${c.name} (${HARNESS_INFO[c.harness].displayName}): ${c.from ?? "(not mapped)"} → ${c.to}\n`);
      out("\n");
      out(formatSyncReport({ plan, statuses, changes, dryRun, verb: "configured", s }));
      return 0;
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      if (e instanceof PackError) {
        if (json) out(JSON.stringify({ ok: false, error: e.message, diagnostics: e.diagnostics }, null, 2) + "\n");
        else {
          out(formatDiagnostics(e.diagnostics, s));
          ctx.stderr(`skillpack configure: ${e.message}; nothing written\n`);
        }
        return 1;
      }
      if (e instanceof InstallError) {
        if (e.usage) throw new UsageError(e.message);
        return fail(e.message);
      }
      if (e instanceof PackRefError || e instanceof GitError || e instanceof VersionError || e instanceof SourceError) return fail(e.message);
      throw e;
    }
  },
};
