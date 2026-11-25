import { HARNESSES, HARNESS_INFO, type Harness } from "../harness.js";
import { formatAgentWarnings, plural, type Style } from "../output.js";
import { formatChangeDescriptions, formatLockedRef, type BlockedItem, type ChangeDescription, type Lock, type SelectionConfig } from "../project/index.js";
import { prepareTargets, type PackStatus } from "./from-config.js";
import { planProjectInstall, type PackTarget, type ProjectInstallPlan } from "./project.js";

/** Fetches the packs at their locked commits (R-CFG-5): never resolves a version; throws one InstallError for packs that aren't locked or no longer satisfy `version`. */
export function prepareSync(o: {
  config: SelectionConfig;
  lock: Lock | null;
  keys: readonly string[];
  detected: readonly Harness[];
  harnessFlag?: readonly Harness[];
  env?: NodeJS.ProcessEnv;
  cliVersion: string;
}): Promise<{ targets: PackTarget[]; statuses: PackStatus[] }> {
  return prepareTargets({
    config: o.config,
    lock: o.lock,
    detected: o.detected,
    keys: o.keys,
    lockedOnly: true,
    ...(o.harnessFlag ? { harnessFlag: o.harnessFlag } : {}),
    ...(o.env ? { env: o.env } : {}),
    cliVersion: o.cliVersion,
  });
}

/**
 * The sync plan: skills and agents regenerated from the locked commits with the given config;
 * edited skill folders protected (blocked), edited agent files kept with a warning, the exclude
 * block made exact. `sync` plans with the config as it is; `configure` first changes the targets'
 * `packConfig` and sets `writeConfig` so skillpack.json is part of the same transaction.
 */
export function planSync(o: {
  projectDir: string;
  cliVersion: string;
  config: SelectionConfig;
  lock: Lock | null;
  targets: PackTarget[];
  force?: boolean;
  writeConfig?: boolean;
  /** New models file content from `resolveTargetModels`. */
  models?: { text: string };
  env?: NodeJS.ProcessEnv;
}): Promise<ProjectInstallPlan> {
  return planProjectInstall({
    projectDir: o.projectDir,
    cliVersion: o.cliVersion,
    config: o.config,
    lock: o.lock,
    targets: o.targets,
    force: o.force ?? false,
    restoreEdited: false,
    blockOnAgents: false,
    exactExclude: true,
    ...(o.writeConfig ? { writeConfig: true } : {}),
    ...(o.models ? { models: o.models } : {}),
    ...(o.env ? { env: o.env } : {}),
  });
}

const why = (b: BlockedItem): string =>
  b.reason === "foreign" ? "not installed by skillpack" : b.reason === "edited" ? "edited since install" : "installed by another pack";

/** The stderr text for a plan that can't be applied (conflicts, or blocked skill folders). */
export function formatBlocked(command: string, plan: ProjectInstallPlan): string {
  let out = "";
  for (const c of plan.conflicts) out += `skillpack ${command}: ${c}\n`;
  if (plan.blocked.length > 0) {
    out += `skillpack ${command}: these skill folders are not owned by skillpack or were edited, so they were kept:\n`;
    for (const b of plan.blocked) out += `  ${b.path} (${why(b)})\n`;
    out += "Nothing was written. Re-run with --force to overwrite them.\n";
  } else out += "Nothing was written.\n";
  return out;
}

const harnessOfPath = (p: string): Harness | null => HARNESSES.find((h) => p.startsWith(`.${h}/`)) ?? null;

/** The sync-style summary shared by `sync` and `configure`. */
export function formatSyncReport(o: {
  plan: ProjectInstallPlan;
  statuses: PackStatus[];
  changes: ChangeDescription[];
  dryRun: boolean;
  /** Packs only in the lock file (sync notes them). */
  orphans?: string[];
  /** Word for the final line: "synced", "configured". */
  verb: string;
  /** The first line of a pack (default: `✔ name ref (verb)`). */
  headline?: (st: PackStatus, index: number) => string;
  s: Style;
}): string {
  const { plan, statuses, s } = o;
  let out = "";
  const touched = new Set(plan.ops.map((x) => x.path));
  const changedAgents = plan.targets.map((t) => t.agentPaths.filter((p) => touched.has(p)));
  for (const [i, st] of statuses.entries()) {
    out += (o.headline ? o.headline(st, i) : `${s.green("✔")} ${st.name} ${formatLockedRef(st.ref, st.commit)} (${o.verb})`) + "\n";
    for (const h of HARNESSES) {
      const ids = changedAgents[i]!.filter((p) => harnessOfPath(p) === h).map((p) => p.split("/").pop()!.replace(/\.(md|toml)$/, ""));
      if (ids.length > 0) out += s.dim(`    agents (${HARNESS_INFO[h].displayName}): ${ids.join(", ")}`) + "\n";
    }
    for (const h of st.skippedHarnesses) out += s.dim(`    ${h} not detected; left its agents alone (use -a ${h} to include them)`) + "\n";
  }
  const deleted = plan.ops.filter((x) => x.type === "delete-file" && x.label === "agent").map((x) => x.path);
  if (plan.skillActions.length > 0 || deleted.length > 0) {
    out += `\n${s.bold("Changes")}\n`;
    for (const a of plan.skillActions) out += `  ${a.action.padEnd(9)} ${a.path}\n`;
    for (const p of deleted) out += `  ${"removed".padEnd(9)} ${p}\n`;
  }
  const shown = plan.targets.filter((_, i) => changedAgents[i]!.length > 0);
  const changedHarnesses = new Set(changedAgents.flat().map(harnessOfPath));
  const warnings = formatAgentWarnings(shown.flatMap((t) => t.warnings).filter((w) => changedHarnesses.has(w.harness)), s);
  const notes = plan.targets.flatMap((t, i) => (changedAgents[i]!.length === 0 ? [] : t.notes).map((n) => `  ${s.yellow("model".padEnd(11))} ${statuses[i]!.name}: ${n}\n`));
  const kept = plan.keptAgents.map((b) => `  ${s.yellow("kept".padEnd(11))} ${b.path} (${why(b)}; not ${b.action === "delete" ? "deleted" : "overwritten"}); use --force\n`);
  if (warnings || notes.length > 0 || kept.length > 0) out += `\n${s.bold("Warnings")}\n${warnings}${notes.join("")}${kept.join("")}`;
  for (const k of o.orphans ?? []) out += s.dim(`\nnote: ${k} is in the lock file but not in skillpack.json; run skillpack install to clean it up`) + "\n";

  if (o.dryRun) out += `\n${s.bold("Would change")}\n${o.changes.length > 0 ? formatChangeDescriptions(o.changes) : "  (nothing)\n"}`;
  if (plan.outsideRepo) {
    out += `\nNot a git repository. Keep these generated files out of version control:\n${plan.excludePaths.map((p) => `  /${p}\n`).join("")}`;
  }
  out += "\n";
  if (plan.ops.length === 0) out += s.green(`✔ already in sync; nothing written`) + "\n";
  else out += s.green(o.dryRun ? "✔ dry run: nothing written" : `✔ ${o.verb} ${plural(statuses.length, "pack")}`) + "\n";
  if (!o.dryRun && plan.commitPaths.length > 0) out += `Commit: ${plan.commitPaths.join(", ")}\n`;
  return out;
}
