import { GENERATE, formatBinding, resolveBindings } from "../bindings.js";
import { lsRemote } from "../git/index.js";
import type { Harness } from "../harness.js";
import type { ModelSource } from "../models/available.js";
import { promptBindings } from "../prompts/bindings.js";
import type { Prompts } from "../prompts/index.js";
import { deriveScope, formatLockedRef, type Lock, type PackConfig, type SelectionConfig } from "../project/index.js";
import { parseSourceSpec } from "../source/parse.js";
import { checkPackConfig, touchedHarnesses, type PackStatus } from "./from-config.js";
import { fetchPack } from "./fetch-pack.js";
import { resolveTargetModels } from "./models.js";
import type { PackTarget, ProjectInstallPlan } from "./project.js";
import { InstallError } from "./select.js";
import { planSync } from "./sync.js";
import { chooseUpdate, chooseUpgrade, type Choice } from "./version-choice.js";

export type MoveMode = "update" | "upgrade";

export interface MoveStatus {
  key: string;
  name: string;
  kind: "moved" | "kept";
  from: string;
  to?: string;
  /** Why a pack stays (pinned, up to date, follows a branch…). */
  note?: string;
  newAgents: string[];
  removedAgents: string[];
  scopeMove?: { from: string; to: string };
  versionRewrite?: { from: string; to: string };
}

export interface MoveResult {
  statuses: MoveStatus[];
  /** Sync-style statuses of the moved packs (for the report). */
  moved: PackStatus[];
  /** Null when no pack moves. */
  plan: ProjectInstallPlan | null;
  failures: string[];
}

/**
 * `update` and `upgrade` (R-VER-7, R-VER-7a): moves the selected packs to a new commit in ONE
 * transaction. The target comes from `chooseUpdate` (newest within the range, `version` kept) or
 * `chooseUpgrade` (highest tag overall, `version` rewritten). The new commit is fetched and
 * validated, every binding is written explicitly (new agents asked or `generate`, agents the pack
 * no longer has dropped), models are matched, and the sync pipeline plans skills, agents (also those
 * under an old scope when `name` changed), the lock, skillpack.json and the exclude block.
 * Nothing is written here; apply `plan.ops`.
 */
export async function planMoveToVersion(o: {
  mode: MoveMode;
  projectDir: string;
  cliVersion: string;
  config: SelectionConfig;
  lock: Lock | null;
  keys: readonly string[];
  detected: readonly Harness[];
  harnessFlag?: readonly Harness[];
  force?: boolean;
  includePrerelease?: boolean;
  source: ModelSource;
  /** Asked about new agents and ambiguous models; without it everything is automatic. */
  prompts?: Prompts | undefined;
  strict?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<MoveResult> {
  const git = o.env ? { env: o.env } : {};
  const problems: string[] = [];
  for (const k of o.keys) if (!o.lock?.packs[k]) problems.push(`${k}: not in the lock file; run skillpack install first`);
  if (problems.length > 0) throw new InstallError(problems.join("\n"));

  const statuses: MoveStatus[] = [];
  const moved: PackStatus[] = [];
  const targets: PackTarget[] = [];
  const config: SelectionConfig = { ...o.config, packs: { ...o.config.packs } };

  for (const key of o.keys) {
    const spec = parseSourceSpec(key);
    const cfg = structuredClone(o.config.packs[key]!);
    const entry = o.lock!.packs[key]!;
    const from = formatLockedRef(entry.ref, entry.commit);
    const remote = await lsRemote(spec.cloneUrl, git);
    const choice: Choice =
      o.mode === "update"
        ? chooseUpdate(cfg.version, entry, remote)
        : chooseUpgrade(cfg.version, entry, remote, { ...(o.includePrerelease ? { includePrerelease: true } : {}) });
    if (choice.kind === "keep") {
      statuses.push({ key, name: key, kind: "kept", from, note: choice.note, newAgents: [], removedAgents: [] });
      continue;
    }

    const { pack } = await fetchPack(spec, { requested: cfg.version, locked: { commit: choice.to.commit, ref: choice.to.ref }, cliVersion: o.cliVersion, ...(o.env ? { env: o.env } : {}) });
    const status: MoveStatus = { key, name: pack.name, kind: "moved", from, to: choice.to.label, newAgents: [], removedAgents: [] };
    if (choice.version !== undefined && choice.version !== cfg.version) {
      status.versionRewrite = { from: cfg.version, to: choice.version };
      cfg.version = choice.version;
    }

    if (cfg.skills !== "*") {
      const have = pack.skills.map((s) => s.name);
      const gone = cfg.skills.filter((n) => !have.includes(n));
      if (gone.length > 0) {
        throw new InstallError(`${key}: ${choice.to.label} no longer has the skills ${gone.join(", ")} listed in skillpack.json; run skillpack configure or edit skillpack.json`);
      }
    }

    // R-VER-7: ask only about agents that are new; drop the ones the pack no longer has.
    const agentNames = pack.agents.map((a) => a.name);
    status.newAgents = agentNames.filter((a) => !(a in cfg.agents));
    status.removedAgents = Object.keys(cfg.agents).filter((a) => !agentNames.includes(a));
    const asked =
      o.prompts && status.newAgents.length > 0
        ? await promptBindings({
            agents: pack.agents.filter((a) => status.newAgents.includes(a.name)).map((a) => ({ name: a.name, description: a.description, fallback: a.fallback })),
            harnesses: cfg.harnesses,
            current: {},
            prompts: o.prompts,
          })
        : resolveBindings(status.newAgents, cfg.harnesses);
    const agents: PackConfig["agents"] = {};
    for (const a of agentNames) {
      const entryBindings = { ...(cfg.agents[a] ?? {}) };
      for (const h of cfg.harnesses) {
        entryBindings[h] ??= formatBinding(asked[a]?.[h] ?? GENERATE);
      }
      agents[a] = entryBindings;
    }
    cfg.agents = agents;

    const scope = cfg.scope ?? pack.name;
    const oldScope = deriveScope(o.projectDir, o.config, o.lock, key).best;
    if (!cfg.scope && oldScope && oldScope !== scope) status.scopeMove = { from: oldScope, to: scope };
    checkPackConfig(key, cfg, pack.skills.map((s) => s.name), agentNames, pack.harnesses, scope);

    targets.push({
      key,
      pack,
      resolved: { ref: choice.to.ref, commit: choice.to.commit },
      packConfig: cfg,
      scope,
      agentHarnesses: touchedHarnesses(cfg.harnesses, o.detected, o.harnessFlag),
    });
    config.packs[key] = cfg;
    moved.push({
      key,
      name: pack.name,
      kind: "locked",
      ref: choice.to.ref,
      commit: choice.to.commit,
      requested: cfg.version,
      skippedHarnesses: cfg.harnesses.filter((h) => !touchedHarnesses(cfg.harnesses, o.detected, o.harnessFlag).includes(h) && !(o.harnessFlag && o.harnessFlag.length > 0)),
    });
    statuses[statuses.length] = status;
  }

  if (targets.length === 0) return { statuses, moved, plan: null, failures: [] };

  const modelResult = await resolveTargetModels({
    projectDir: o.projectDir,
    targets,
    source: o.source,
    prompts: o.prompts,
    ...(o.strict ? { strict: true } : {}),
  });
  if (modelResult.failures.length > 0) return { statuses, moved, plan: null, failures: modelResult.failures };

  const plan = await planSync({
    projectDir: o.projectDir,
    cliVersion: o.cliVersion,
    config,
    lock: o.lock,
    targets,
    force: o.force ?? false,
    writeConfig: true,
    ...(modelResult.models ? { models: modelResult.models } : {}),
    ...(o.env ? { env: o.env } : {}),
  });
  return { statuses, moved, plan, failures: [] };
}
