import type { AgentWarning } from "../agents/index.js";
import { agentIdFor, bindingOf, type Bindings } from "../bindings.js";
import type { TreeFile } from "../fs/tree.js";
import { scopedName } from "../names.js";
import {
  emptyLock, findOwnedAgentFiles, lockOwner, packBindings, planChanges, planExcludeUpdate, serializeConfig, serializeLock,
  type BlockedItem, type DesiredPack, type Lock, type PackConfig, type ProjectOp, type SelectionConfig,
} from "../project/index.js";
import { INSTALLED_SKILLS_DIR } from "../project/paths.js";
import { CONFIG_FILE, LOCK_FILE } from "../project/paths.js";
import type { LoadedPack } from "./fetch-pack.js";
import { planInstall } from "./plan.js";
import { findNpxSkillsDuplicates } from "./npx-skills.js";

export interface PackInstallInput {
  projectDir: string;
  cliVersion: string;
  /** Normalized source key. */
  key: string;
  pack: LoadedPack;
  /** What goes into the lock file; `label` is the version shown in agent headers (tag or short commit). */
  resolved: { tag: string | null; commit: string };
  /** The complete entry to save in skillpack.json (every binding explicit). */
  packConfig: PackConfig;
  /** Effective scope: `packConfig.scope` or the manifest name. */
  scope: string;
  config: SelectionConfig;
  lock: Lock | null;
  env?: NodeJS.ProcessEnv;
  force?: boolean;
  restoreEdited?: boolean;
}

export interface InstalledSkillInfo {
  name: string;
  folder: string;
  description: string;
  /** Files with the executable bit, as project-relative paths. */
  executables: string[];
}

export interface PackInstallPlan {
  /** Everything to apply: skills, agents, skillpack.json, the lock file and the exclude block. Empty when blocked or in conflict. */
  ops: ProjectOp[];
  blocked: BlockedItem[];
  /** Collisions with other packs (R-SCP-4); never overridable with --force. */
  conflicts: string[];
  warnings: AgentWarning[];
  /** Pack-level notes, e.g. that models aren't matched yet. */
  notes: string[];
  skills: InstalledSkillInfo[];
  bindings: Bindings;
  agentIds: string[];
  /** Generated agent paths, to keep out of git. */
  excludePaths: string[];
  /** True when there is no git repository to hold the exclude block (R-SAF-7). */
  outsideRepo: boolean;
  /** Skill folders from `npx skills` that duplicate this pack (R-SAF-6). */
  npxDuplicates: string[];
  files: TreeFile[];
}

const MODEL_NOTE = "model matching isn't available yet; generated agents use the parent session's model";

/**
 * Renders one pack for the project and plans every write for installing it: skills, generated
 * agents, skillpack.json, skillpack-lock.json and the exclude block. Shared by add, install, sync,
 * update and upgrade. Writes nothing; apply the returned ops with `applyChanges`.
 */
export async function planPackInstall(input: PackInstallInput): Promise<PackInstallPlan> {
  const { pack, key, scope, packConfig, projectDir } = input;
  const harnesses = packConfig.harnesses;
  const selected = packConfig.skills === "*" ? pack.skills : pack.skills.filter((s) => (packConfig.skills as string[]).includes(s.name));
  const bindings = packBindings(packConfig, pack.agents.map((a) => a.name), harnesses);
  const label = input.resolved.tag ?? input.resolved.commit.slice(0, 7);

  const rendered = planInstall({
    scope,
    pack: { source: key, version: label },
    skills: selected.map((s) => ({ name: s.name, files: s.files })),
    agents: pack.agents,
    harnesses,
    bindings,
  });

  const desired: DesiredPack = { source: key, skills: new Map(), agents: new Map() };
  const folderFiles = new Map<string, TreeFile[]>();
  for (const f of rendered.files) {
    if (f.path.startsWith(`${INSTALLED_SKILLS_DIR}/`)) {
      const [folderPath, rest] = splitSkillPath(f.path);
      (folderFiles.get(folderPath) ?? folderFiles.set(folderPath, []).get(folderPath)!).push({ ...f, path: rest });
    } else desired.agents.set(f.path, f.content);
  }
  for (const [p, files] of folderFiles) desired.skills.set(p, files);

  const skills: InstalledSkillInfo[] = selected.map((s) => {
    const folder = scopedName(scope, s.name);
    return {
      name: s.name,
      folder,
      description: s.description,
      executables: s.files.filter((f) => (f.mode & 0o111) !== 0).map((f) => `${INSTALLED_SKILLS_DIR}/${folder}/${f.path}`),
    };
  });
  const agentIds = [...new Set(pack.agents.flatMap((a) => harnesses.map((h) => agentIdFor(scope, a.name, bindingOf(bindings, a.name, h)))).filter((x): x is string => x !== null))];

  const plan: PackInstallPlan = {
    ops: [],
    blocked: [],
    conflicts: findConflicts(input, desired),
    warnings: rendered.warnings,
    notes: desired.agents.size > 0 ? [MODEL_NOTE] : [],
    skills,
    bindings,
    agentIds,
    excludePaths: [...desired.agents.keys()].sort(),
    outsideRepo: false,
    npxDuplicates: findNpxSkillsDuplicates({
      projectDir,
      key,
      lock: input.lock,
      skills: selected.map((s) => ({ name: s.name, description: s.description })),
    }),
    files: rendered.files,
  };
  if (plan.conflicts.length > 0) return plan;

  const changes = planChanges(
    { projectDir, lock: input.lock, desired: [desired] },
    { ...(input.force !== undefined ? { force: input.force } : {}), ...(input.restoreEdited !== undefined ? { restoreEdited: input.restoreEdited } : {}) },
  );
  plan.blocked = changes.blocked;
  if (changes.blocked.length > 0) return plan;

  const config: SelectionConfig = { ...input.config, packs: { ...input.config.packs, [key]: packConfig } };
  const lock: Lock = input.lock ? structuredClone(input.lock) : emptyLock(input.cliVersion);
  lock.cli = input.cliVersion;
  lock.packs[key] = { version: input.resolved.tag, commit: input.resolved.commit, skills: changes.skillHashes[key] ?? {} };

  plan.ops = [
    ...changes.ops,
    { type: "write-json", path: CONFIG_FILE, content: serializeConfig(config), label: "config" },
    { type: "write-json", path: LOCK_FILE, content: serializeLock(lock), label: "lock" },
  ];
  if (plan.excludePaths.length > 0) {
    const ex = await planExcludeUpdate(projectDir, { add: plan.excludePaths }, input.env);
    if (ex !== null && "outsideRepo" in ex) plan.outsideRepo = true;
    else if (ex !== null) plan.ops.push(ex);
  }
  return plan;
}

function splitSkillPath(path: string): [string, string] {
  const parts = path.split("/");
  return [parts.slice(0, 3).join("/"), parts.slice(3).join("/")];
}

/** R-SCP-4: another configured pack with the same scope, or one that owns a name this install would write. */
function findConflicts(input: PackInstallInput, desired: DesiredPack): string[] {
  const out: string[] = [];
  for (const [other, cfg] of Object.entries(input.config.packs)) {
    if (other !== input.key && cfg.scope === input.scope) out.push(`the scope "${input.scope}" is already used by ${other}; choose another with --as`);
  }
  for (const p of desired.skills.keys()) {
    const owner = lockOwner(input.lock, p);
    if (owner !== null && owner !== input.key) out.push(`${p} is already installed by ${owner}; choose another scope with --as`);
  }
  const others = new Set([...Object.keys(input.config.packs), ...Object.keys(input.lock?.packs ?? {})]);
  others.delete(input.key);
  for (const other of others) {
    for (const p of findOwnedAgentFiles(input.projectDir, other)) {
      if (desired.agents.has(p)) out.push(`${p} is already generated for ${other}; choose another scope with --as`);
    }
  }
  return out;
}
