import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentIdFor, bindingOf, type Bindings } from "../bindings.js";
import type { AgentWarning } from "../agents/index.js";
import type { TreeFile } from "../fs/tree.js";
import type { Harness } from "../harness.js";
import { scopedName } from "../names.js";
import {
  emptyLock, findOwnedAgentFiles, listAgentSources, lockOwner, packBindings, planChanges, planExcludeUpdate, pruneNoops, serializeConfig, serializeLock,
  type BlockedItem, type DesiredPack, type Lock, type PackConfig, type ProjectOp, type SelectionConfig, type SkillAction,
} from "../project/index.js";
import { refTag } from "../project/lock.js";
import { CONFIG_FILE, INSTALLED_SKILLS_DIR, LOCK_FILE, MODELS_FILE } from "../project/paths.js";
import type { LoadedPack } from "./fetch-pack.js";
import { findNpxSkillsDuplicates } from "./npx-skills.js";
import { planInstall } from "./plan.js";

/** One configured pack, fetched and ready to render. */
export interface PackTarget {
  key: string;
  pack: LoadedPack;
  /** What goes into the lock file. */
  resolved: { ref: string | null; commit: string };
  /** The pack's entry in skillpack.json (bindings explicit). */
  packConfig: PackConfig;
  /** Effective scope: `packConfig.scope` or the manifest name. */
  scope: string;
  /** Harnesses to generate agents for: the configured ones that are detected (all of them for `add`). */
  agentHarnesses: Harness[];
  /** Concrete model of an agent in a harness (from `resolveTargetModels`); undefined = generate without a model. */
  modelFor?: (agent: string, harness: Harness) => string | undefined;
  /** Warnings from model matching, shown with the agent warnings. */
  modelWarnings?: AgentWarning[];
}

export interface InstalledSkillInfo {
  name: string;
  folder: string;
  description: string;
  /** Files with the executable bit, as project-relative paths. */
  executables: string[];
}

export interface TargetDetail {
  key: string;
  scope: string;
  skills: InstalledSkillInfo[];
  bindings: Bindings;
  agentIds: string[];
  /** Generated agent files (project-relative). */
  agentPaths: string[];
  warnings: AgentWarning[];
  notes: string[];
  npxDuplicates: string[];
}

export interface ProjectInstallInput {
  projectDir: string;
  cliVersion: string;
  /** The config as it will be saved (add changes it; install doesn't). */
  config: SelectionConfig;
  lock: Lock | null;
  targets: PackTarget[];
  /** Locked packs that are no longer configured. */
  removeKeys?: string[];
  /** New content for skillpack.models.json (from `resolveTargetModels`); written in the same transaction and kept out of git. */
  models?: { text: string };
  /** Write skillpack.json (add). Install never does. */
  writeConfig?: boolean;
  force?: boolean;
  /** Rewrite edited skill folders from the lock (install, R-VER-6). */
  restoreEdited?: boolean;
  /** Blocked agent files fail the plan (add) instead of being kept with a warning (install). */
  blockOnAgents?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Delete locked skill folders of removed packs even when edited (install). `remove` keeps edited ones unless forced. Default true. */
  deleteEditedOnRemove?: boolean;
  /** Drop the exclude entries of the agent files this plan deletes (`remove` only, R-SAF-7). */
  pruneExclude?: boolean;
  /** Make the exclude block list exactly the generated agent files that exist afterwards (every file with a skillpack header, minus the ones this plan deletes, plus the ones it writes) and the models file if present (`sync`). */
  exactExclude?: boolean;
  /** More exclude entries to drop (e.g. a models file that no longer exists). */
  excludeRemove?: string[];
  /** Edits the new lock after it is cloned from `lock` (for changes the planner doesn't know about). */
  lockEdit?: (lock: Lock) => void;
  /** Extra operations, planned by the caller, and the items it already found blocked. */
  extraOps?: ProjectOp[];
  extraBlocked?: BlockedItem[];
}

export interface RemovedPackDetail {
  key: string;
  skills: string[];
  /** Locked skill folders with local edits that are deleted anyway. */
  editedSkills: string[];
}

export interface ProjectInstallPlan {
  /** Everything to apply, without no-ops. Empty when blocked or in conflict. */
  ops: ProjectOp[];
  /** Skill folders (and, for add, agent files) that can't be written without --force. */
  blocked: BlockedItem[];
  /** Agent files kept because they're foreign or edited (install). */
  keptAgents: BlockedItem[];
  /** Collisions between packs (R-SCP-4); never overridable. */
  conflicts: string[];
  skillActions: SkillAction[];
  targets: TargetDetail[];
  removed: RemovedPackDetail[];
  /** The lock file as it will be written, and whether its pack entries differ from the current lock. */
  newLock: Lock;
  lockChanged: boolean;
  /** Generated agent paths, to keep out of git. */
  excludePaths: string[];
  outsideRepo: boolean;
  /**
   * Committed files that really change: skillpack.json and the lock file when they are written,
   * and the skill folders whose locked content changes (added, updated or removed; a restore
   * brings a folder back to what is already committed, so it isn't listed).
   */
  commitPaths: string[];
}

function splitSkillPath(path: string): [string, string] {
  const parts = path.split("/");
  return [parts.slice(0, 3).join("/"), parts.slice(3).join("/")];
}

function render(projectDir: string, lock: Lock | null, t: PackTarget): { desired: DesiredPack; detail: TargetDetail } {
  const { pack, packConfig, scope } = t;
  const harnesses = packConfig.harnesses;
  const selected = packConfig.skills === "*" ? pack.skills : pack.skills.filter((s) => (packConfig.skills as string[]).includes(s.name));
  const bindings = packBindings(packConfig, pack.agents.map((a) => a.name), harnesses);
  const rendered = planInstall({
    scope,
    pack: { source: t.key, version: refTag(t.resolved.ref) ?? t.resolved.commit.slice(0, 7) },
    skills: selected.map((s) => ({ name: s.name, files: s.files })),
    allSkillNames: pack.skills.map((s) => s.name),
    agents: pack.agents,
    harnesses,
    agentHarnesses: t.agentHarnesses,
    bindings,
    ...(t.modelFor ? { modelFor: t.modelFor } : {}),
  });

  const desired: DesiredPack = { source: t.key, skills: new Map(), agents: new Map(), agentHarnesses: t.agentHarnesses };
  const folderFiles = new Map<string, TreeFile[]>();
  for (const f of rendered.files) {
    if (f.path.startsWith(`${INSTALLED_SKILLS_DIR}/`)) {
      const [folderPath, rest] = splitSkillPath(f.path);
      (folderFiles.get(folderPath) ?? folderFiles.set(folderPath, []).get(folderPath)!).push({ ...f, path: rest });
    } else desired.agents.set(f.path, f.content);
  }
  for (const [p, files] of folderFiles) desired.skills.set(p, files);

  const skills = selected.map((s): InstalledSkillInfo => {
    const folder = scopedName(scope, s.name);
    return {
      name: s.name,
      folder,
      description: s.description,
      executables: s.files.filter((f) => (f.mode & 0o111) !== 0).map((f) => `${INSTALLED_SKILLS_DIR}/${folder}/${f.path}`),
    };
  });
  const agentIds = [
    ...new Set(
      pack.agents
        .flatMap((a) => t.agentHarnesses.map((h) => agentIdFor(scope, a.name, bindingOf(bindings, a.name, h))))
        .filter((x): x is string => x !== null),
    ),
  ];
  return {
    desired,
    detail: {
      key: t.key,
      scope,
      skills,
      bindings,
      agentIds,
      agentPaths: [...desired.agents.keys()].sort(),
      warnings: [...rendered.warnings, ...(t.modelWarnings ?? [])],
      notes: [],
      npxDuplicates: findNpxSkillsDuplicates({
        projectDir,
        key: t.key,
        lock,
        skills: selected.map((s) => ({ name: s.name, description: s.description })),
      }),
    },
  };
}

/** R-SCP-4: collisions between packs. Never overridable with --force. */
function findConflicts(input: ProjectInstallInput, desired: DesiredPack[], scopes: Map<string, string>): string[] {
  const out: string[] = [];
  const byScope = new Map<string, string>();
  const keys = new Set([...Object.keys(input.config.packs), ...scopes.keys()]);
  for (const key of keys) {
    const scope = scopes.get(key) ?? input.config.packs[key]?.scope;
    if (scope === undefined) continue;
    const other = byScope.get(scope);
    if (other !== undefined) out.push(`the scope "${scope}" is already used by ${other} (and ${key}); choose another with --as`);
    else byScope.set(scope, key);
  }
  const mine = new Set(desired.map((d) => d.source));
  const gone = new Set(input.removeKeys ?? []);
  const claimed = new Map<string, string>();
  for (const d of desired) {
    for (const p of [...d.skills.keys(), ...d.agents.keys()]) {
      const prev = claimed.get(p);
      if (prev !== undefined && prev !== d.source) out.push(`${p} would be written by both ${prev} and ${d.source}; choose another scope with --as`);
      claimed.set(p, d.source);
      const owner = lockOwner(input.lock, p);
      if (owner !== null && owner !== d.source && !mine.has(owner) && !gone.has(owner)) {
        out.push(`${p} is already installed by ${owner}; choose another scope with --as`);
      }
    }
  }
  const others = new Set([...Object.keys(input.config.packs), ...Object.keys(input.lock?.packs ?? {})]);
  for (const k of [...mine, ...gone]) others.delete(k);
  for (const other of others) {
    for (const p of findOwnedAgentFiles(input.projectDir, other)) {
      if (claimed.has(p)) out.push(`${p} is already generated for ${other}; choose another scope with --as`);
    }
  }
  return [...new Set(out)];
}

/**
 * Plans the whole project state for the given packs in one go (shared by add and install; sync,
 * update and upgrade will use it too): skills, generated agents, removed packs, the lock file, the
 * config (add only) and the exclude block. Writes nothing; apply `ops` with `applyChanges`.
 */
export async function planProjectInstall(input: ProjectInstallInput): Promise<ProjectInstallPlan> {
  const { projectDir, lock } = input;
  const rendered = input.targets.map((t) => render(projectDir, lock, t));
  const removeKeys = input.removeKeys ?? [];
  const removedDesired: DesiredPack[] = removeKeys.map((source) => ({ source, skills: new Map(), agents: new Map(), deleteEditedSkills: input.deleteEditedOnRemove ?? true }));
  const desired = [...rendered.map((r) => r.desired), ...removedDesired];

  const plan: ProjectInstallPlan = {
    ops: [],
    blocked: [],
    keptAgents: [],
    conflicts: findConflicts(input, rendered.map((r) => r.desired), new Map(input.targets.map((t) => [t.key, t.scope]))),
    skillActions: [],
    targets: rendered.map((r) => r.detail),
    removed: [],
    newLock: lock ? structuredClone(lock) : emptyLock(input.cliVersion),
    lockChanged: false,
    excludePaths: [...new Set(rendered.flatMap((r) => r.detail.agentPaths))].sort(),
    outsideRepo: false,
    commitPaths: [],
  };
  if (plan.conflicts.length > 0) return plan;

  const changes = planChanges(
    { projectDir, lock, desired },
    { ...(input.force !== undefined ? { force: input.force } : {}), ...(input.restoreEdited !== undefined ? { restoreEdited: input.restoreEdited } : {}) },
  );
  plan.skillActions = changes.skillActions;
  plan.blocked = [...changes.blocked.filter((b) => b.kind === "skill" || input.blockOnAgents), ...(input.extraBlocked ?? [])];
  plan.keptAgents = changes.blocked.filter((b) => b.kind === "agent" && !input.blockOnAgents);
  plan.removed = removeKeys.map((key) => ({
    key,
    skills: changes.skillActions.filter((a) => a.pack === key && a.action === "removed").map((a) => a.path),
    editedSkills: changes.skillActions.filter((a) => a.pack === key && a.action === "removed" && a.edited).map((a) => a.path),
  }));
  if (plan.blocked.length > 0) return plan;

  const newLock = plan.newLock;
  input.lockEdit?.(newLock);
  for (const key of removeKeys) delete newLock.packs[key];
  for (const t of input.targets) {
    newLock.packs[t.key] = { ref: t.resolved.ref, commit: t.resolved.commit, skills: changes.skillHashes[t.key] ?? {} };
  }
  plan.lockChanged = serializeLock(newLock) !== serializeLock(lock ?? { cli: newLock.cli, packs: {} });
  if (plan.lockChanged || lock === null) newLock.cli = input.cliVersion;

  const ops: ProjectOp[] = [...changes.ops, ...(input.extraOps ?? [])];
  if (input.writeConfig) {
    const config: SelectionConfig = {
      ...input.config,
      packs: { ...input.config.packs, ...Object.fromEntries(input.targets.map((t) => [t.key, t.packConfig])) },
    };
    ops.push({ type: "write-json", path: CONFIG_FILE, content: serializeConfig(config), label: "config" });
  }
  if (input.models) ops.push({ type: "write-json", path: MODELS_FILE, content: input.models.text, label: "models" });
  if (plan.lockChanged || lock === null) ops.push({ type: "write-json", path: LOCK_FILE, content: serializeLock(newLock), label: "lock" });
  // The models file is local (R-SAF-7): keep it out of git when it is written or exists.
  if (input.models || existsSync(join(projectDir, MODELS_FILE))) plan.excludePaths = [...new Set([...plan.excludePaths, MODELS_FILE])].sort();
  const drop = [
    ...(input.pruneExclude ? changes.ops.filter((o) => o.type === "delete-file" && o.label === "agent").map((o) => o.path) : []),
    ...(input.excludeRemove ?? []),
  ];
  if (plan.excludePaths.length > 0 || drop.length > 0 || input.exactExclude) {
    let change: { add?: string[]; remove?: string[]; set?: string[] } = { add: plan.excludePaths, remove: drop };
    if (input.exactExclude) {
      const final = new Set<string>();
      for (const src of listAgentSources(projectDir)) for (const p of findOwnedAgentFiles(projectDir, src)) final.add(p);
      for (const o of changes.ops) if (o.type === "delete-file" && o.label === "agent") final.delete(o.path);
      for (const p of plan.excludePaths) final.add(p);
      if (input.models || existsSync(join(projectDir, MODELS_FILE))) final.add(MODELS_FILE);
      change = { set: [...final] };
    }
    const ex = await planExcludeUpdate(projectDir, change, input.env);
    if (ex !== null && "outsideRepo" in ex) plan.outsideRepo = true;
    else if (ex !== null) ops.push(ex);
  }
  plan.ops = pruneNoops(projectDir, ops);

  const touched = new Set(plan.ops.map((o) => o.path));
  const folders = new Set<string>();
  for (const key of new Set([...Object.keys(lock?.packs ?? {}), ...Object.keys(newLock.packs)])) {
    const was = lock?.packs[key]?.skills ?? {};
    const now = newLock.packs[key]?.skills ?? {};
    for (const p of new Set([...Object.keys(was), ...Object.keys(now)])) if (was[p] !== now[p]) folders.add(p);
  }
  plan.commitPaths = [...[CONFIG_FILE, LOCK_FILE].filter((p) => touched.has(p)), ...[...folders].sort()];
  return plan;
}
