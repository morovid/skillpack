import { resolve } from "node:path";
import { BindingError, bindingsFromOptions, formatBinding, agentIdFor, bindingOf } from "../../core/bindings.js";
import { GitError } from "../../core/git/index.js";
import { detectHarnesses, systemDetectEnv } from "../../core/harness-detect.js";
import { HARNESS_INFO, type Harness } from "../../core/harness.js";
import { fetchPack, PackError } from "../../core/install/fetch-pack.js";
import { planPackInstall } from "../../core/install/pipeline.js";
import { InstallError, selectHarnesses, selectSkills } from "../../core/install/select.js";
import { overlongScopedNames, scopeProblem } from "../../core/names.js";
import { createStyle, formatAgentWarnings, formatBindingsTable, formatDiagnostics, plural } from "../../core/output.js";
import {
  applyChanges, describeChanges, emptyConfig, formatChangeDescriptions, readConfig, readLock, INSTALLED_SKILLS_DIR,
  type Lock, type PackConfig, type SelectionConfig,
} from "../../core/project/index.js";
import { SourceError, parseSourceSpec } from "../../core/source/parse.js";
import { resolvedRef, VersionError } from "../../core/source/versions.js";
import { CLI_VERSION } from "../../core/version.js";
import { UsageError, type Command } from "../types.js";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");

export const add: Command = {
  name: "add",
  summary: "Install a skill pack into the current project",
  usage:
    "skillpack add <source>[@version] [-a <harness>]... [-s <skills|*>]... [--agent <names|*|none>] [--as <scope>] [-y] [--dry-run] [--force] [--json]",
  options: {
    harness: { type: "string", short: "a", multiple: true },
    skill: { type: "string", short: "s", multiple: true },
    agent: { type: "string" },
    as: { type: "string" },
    yes: { type: "boolean", short: "y" },
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
    json: { type: "boolean" },
  },
  optionHelp: {
    harness: "Harness to install for: opencode, codex or * (default: detected)",
    skill: "Skills to install, names or * (default: all)",
    agent: "Agents to generate; the others are bound to none (names, * or none)",
    as: "Install under this scope instead of the pack's name",
    yes: "Don't ask; use the defaults",
    "dry-run": "Show what would change and write nothing",
    force: "Overwrite skill folders and agent files that skillpack doesn't own or that were edited",
    json: "Print the result as JSON",
  },
  async run(ctx) {
    if (ctx.positionals.length !== 1) throw new UsageError("expected one source, e.g. skillpack add owner/repo");
    const s = createStyle(ctx.color);
    const json = ctx.values.json === true;
    const dryRun = ctx.values["dry-run"] === true;
    const projectDir = resolve(ctx.cwd);
    const out = (t: string): void => ctx.stdout(t);
    const fail = (message: string): number => {
      if (json) out(JSON.stringify({ ok: false, error: message }, null, 2) + "\n");
      else ctx.stderr(`skillpack add: ${message}\n`);
      return 1;
    };

    let spec;
    try {
      spec = parseSourceSpec(ctx.positionals[0]!);
    } catch (e) {
      if (e instanceof SourceError) throw new UsageError(e.message);
      throw e;
    }
    const asScope = typeof ctx.values.as === "string" ? ctx.values.as : undefined;
    if (asScope !== undefined) {
      const problem = scopeProblem(asScope);
      if (problem) throw new UsageError(`--as: ${problem}`);
    }

    const cfgState = readConfig(projectDir);
    if (cfgState.status === "invalid") return fail(cfgState.errors.join("\n"));
    const lockState = readLock(projectDir);
    if (lockState.status === "invalid") return fail(lockState.errors.join("\n"));
    const config: SelectionConfig = cfgState.status === "ok" ? cfgState.value : emptyConfig();
    const lock: Lock | null = lockState.status === "ok" ? lockState.value : null;

    let fetched;
    try {
      fetched = await fetchPack(spec, { requested: spec.version, env: ctx.env, cliVersion: CLI_VERSION });
    } catch (e) {
      if (e instanceof PackError) {
        if (json) out(JSON.stringify({ ok: false, error: e.message, diagnostics: e.diagnostics }, null, 2) + "\n");
        else {
          out(formatDiagnostics(e.diagnostics, s));
          ctx.stderr(`skillpack add: ${e.message}; nothing written\n`);
        }
        return 1;
      }
      if (e instanceof GitError || e instanceof VersionError) return fail(e.message);
      throw e;
    }
    const { pack, resolved } = fetched;

    let harnesses: Harness[];
    let skills: "*" | string[];
    let bindings;
    try {
      const detected = ctx.detectHarnesses
        ? ctx.detectHarnesses(projectDir)
        : detectHarnesses(systemDetectEnv(projectDir, ctx.env));
      harnesses = selectHarnesses({ flags: strings(ctx.values.harness), supported: pack.harnesses, detected });
      skills = selectSkills({ flags: strings(ctx.values.skill), available: pack.skills.map((x) => x.name) });
      bindings = bindingsFromOptions({
        agents: pack.agents.map((a) => a.name),
        harnesses,
        agentOption: typeof ctx.values.agent === "string" ? ctx.values.agent : undefined,
      });
    } catch (e) {
      if (e instanceof InstallError) {
        if (e.usage) throw new UsageError(e.message);
        return fail(e.message);
      }
      if (e instanceof BindingError) throw new UsageError(e.message);
      throw e;
    }

    const scope = asScope ?? pack.name;
    const chosen = skills === "*" ? pack.skills.map((x) => x.name) : skills;
    const long = overlongScopedNames(scope, [...chosen, ...pack.agents.map((a) => a.name)]);
    if (long.length > 0) return fail(`installed names too long (max 64): ${long.join(", ")}; choose a shorter scope with --as`);

    const packConfig: PackConfig = {
      version: resolved.saved,
      harnesses,
      skills,
      agents: Object.fromEntries(
        pack.agents.map((a) => [a.name, Object.fromEntries(harnesses.map((h) => [h, formatBinding(bindingOf(bindings, a.name, h))]))]),
      ),
    };
    if (asScope !== undefined) packConfig.scope = asScope;

    const plan = await planPackInstall({
      projectDir,
      cliVersion: CLI_VERSION,
      key: spec.key,
      pack,
      resolved: { ref: resolvedRef(resolved), commit: resolved.commit },
      packConfig,
      scope,
      config,
      lock,
      env: ctx.env,
      force: ctx.values.force === true,
    });

    const versionLabel = resolved.tag
      ? `${resolved.tag}${resolved.saved === resolved.tag ? "" : ` (${resolved.saved})`}`
      : `${resolved.saved}@${resolved.commit.slice(0, 7)}`;

    if (plan.conflicts.length > 0 || plan.blocked.length > 0) {
      if (json) {
        out(JSON.stringify({ ok: false, error: plan.conflicts.length ? "conflict" : "blocked", conflicts: plan.conflicts, blocked: plan.blocked }, null, 2) + "\n");
      } else {
        for (const c of plan.conflicts) ctx.stderr(`skillpack add: ${c}\n`);
        if (plan.blocked.length > 0) {
          ctx.stderr("skillpack add: these files are not owned by skillpack or were edited, so they were kept:\n");
          for (const b of plan.blocked) {
            const why = b.reason === "foreign" ? "not installed by skillpack" : b.reason === "edited" ? "edited since install" : "installed by another pack";
            ctx.stderr(`  ${b.path} (${why})\n`);
          }
          ctx.stderr("Nothing was written. Re-run with --force to overwrite them.\n");
        } else ctx.stderr("Nothing was written.\n");
      }
      return 1;
    }

    const changes = describeChanges(projectDir, plan.ops);
    if (!dryRun) applyChanges(projectDir, plan.ops);

    if (json) {
      out(
        JSON.stringify(
          {
            ok: true,
            dryRun,
            source: spec.key,
            ref: resolvedRef(resolved),
            requested: resolved.saved,
            commit: resolved.commit,
            scope,
            harnesses,
            skills: plan.skills,
            bindings: Object.fromEntries(
              pack.agents.map((a) => [a.name, Object.fromEntries(harnesses.map((h) => [h, { binding: formatBinding(bindingOf(bindings, a.name, h)), id: agentIdFor(scope, a.name, bindingOf(bindings, a.name, h)) }]))]),
            ),
            warnings: plan.warnings,
            notes: plan.notes,
            changes,
            excludePaths: plan.excludePaths,
            outsideRepo: plan.outsideRepo,
            npxSkillsDuplicates: plan.npxDuplicates,
          },
          null,
          2,
        ) + "\n",
      );
      return 0;
    }

    if (ctx.values.yes !== true) {
      out(s.dim("Interactive selection isn't available yet; using the defaults (as with -y).") + "\n\n");
    }
    out(`${s.bold(pack.name)}${pack.description ? ` — ${pack.description}` : ""}\n`);
    out(`${s.dim("source")}  ${spec.key}  ${versionLabel}\n`);
    out(`${s.dim("scope")}   ${scope}   ${s.dim("harnesses")} ${harnesses.map((h) => HARNESS_INFO[h].displayName).join(", ")}\n\n`);

    out(`${s.bold("Skills")}\n`);
    const width = Math.max(0, ...plan.skills.map((x) => x.folder.length));
    for (const sk of plan.skills) out(`  ${sk.folder.padEnd(width)}  ${sk.description}\n`);
    const scripts = plan.skills.flatMap((x) => x.executables);
    if (scripts.length > 0) {
      out(`\n${s.yellow("Executable scripts")} (review them before use; skillpack never runs them):\n`);
      for (const p of scripts) out(`  ${p}\n`);
    }

    if (pack.agents.length > 0) {
      out(`\n${s.bold("Agents")}\n`);
      out(formatBindingsTable(pack.agents.map((a) => a.name), harnesses, bindings, scope, s));
    }
    if (plan.warnings.length > 0 || plan.notes.length > 0 || plan.npxDuplicates.length > 0 || pack.warnings.length > 0) {
      out(`\n${s.bold("Warnings")}\n`);
      out(formatAgentWarnings(plan.warnings, s));
      for (const n of plan.notes) out(`  ${s.yellow("model".padEnd(11))} ${n}\n`);
      for (const d of pack.warnings) out(`  ${s.yellow("pack".padEnd(11))} ${d.file ?? ""}: ${d.message}\n`);
      if (plan.npxDuplicates.length > 0) {
        out(
          `  ${s.yellow("duplicate".padEnd(11))} ${plan.npxDuplicates.join(", ")} already installed by npx skills, so skills would load twice.\n` +
            `              Remove them with: npx skills remove ${plan.npxDuplicates.join(" ")}\n`,
        );
      }
    }

    out(`\n${s.bold(dryRun ? "Would change" : "Changes")}\n`);
    out(changes.length > 0 ? formatChangeDescriptions(changes) : "  (nothing)\n");
    if (plan.outsideRepo) {
      out(`\nNot a git repository. Keep these generated files out of version control:\n${plan.excludePaths.map((p) => `  /${p}\n`).join("")}`);
    }
    out(
      `\n${s.green(dryRun ? "✔ dry run: nothing written" : `✔ added ${pack.name} (${plural(plan.skills.length, "skill")}, ${plural(plan.excludePaths.length, "agent file")})`)}\n`,
    );
    if (!dryRun && plan.commitPaths.length > 0) {
      const skillGlob = `${INSTALLED_SKILLS_DIR}/${scope.replaceAll("_", "-")}-*`;
      const files = plan.commitPaths.map((p) => (p.startsWith(`${INSTALLED_SKILLS_DIR}/`) ? skillGlob : p));
      out(`Commit: ${[...new Set(files)].join(", ")}\n`);
    }
    return 0;
  },
};
