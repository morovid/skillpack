import type { AgentWarning } from "../agents/index.js";
import type { Bindings } from "../bindings.js";
import type { TreeFile } from "../fs/tree.js";
import type { BlockedItem, Lock, PackConfig, ProjectOp, SelectionConfig } from "../project/index.js";
import type { LoadedPack } from "./fetch-pack.js";
import { planProjectInstall, type InstalledSkillInfo } from "./project.js";

export type { InstalledSkillInfo } from "./project.js";

export interface PackInstallInput {
  projectDir: string;
  cliVersion: string;
  /** Normalized source key. */
  key: string;
  pack: LoadedPack;
  resolved: { tag: string | null; branch: string | null; commit: string };
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

export interface PackInstallPlan {
  ops: ProjectOp[];
  blocked: BlockedItem[];
  conflicts: string[];
  warnings: AgentWarning[];
  notes: string[];
  skills: InstalledSkillInfo[];
  bindings: Bindings;
  agentIds: string[];
  excludePaths: string[];
  outsideRepo: boolean;
  npxDuplicates: string[];
  files: TreeFile[];
  commitPaths: string[];
}

/** Installs a single pack and saves it to skillpack.json (what `add` does). */
export async function planPackInstall(input: PackInstallInput): Promise<PackInstallPlan> {
  const plan = await planProjectInstall({
    projectDir: input.projectDir,
    cliVersion: input.cliVersion,
    config: input.config,
    lock: input.lock,
    targets: [{ key: input.key, pack: input.pack, resolved: input.resolved, packConfig: input.packConfig, scope: input.scope, agentHarnesses: input.packConfig.harnesses }],
    writeConfig: true,
    blockOnAgents: true,
    ...(input.force !== undefined ? { force: input.force } : {}),
    ...(input.restoreEdited !== undefined ? { restoreEdited: input.restoreEdited } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  const d = plan.targets[0]!;
  return {
    ops: plan.ops,
    blocked: plan.blocked,
    conflicts: plan.conflicts,
    warnings: d.warnings,
    notes: d.notes,
    skills: d.skills,
    bindings: d.bindings,
    agentIds: d.agentIds,
    excludePaths: plan.excludePaths,
    outsideRepo: plan.outsideRepo,
    npxDuplicates: d.npxDuplicates,
    files: [],
    commitPaths: plan.commitPaths,
  };
}
