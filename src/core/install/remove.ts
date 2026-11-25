import { existsSync } from "node:fs";
import { join } from "node:path";
import { HARNESSES, type Harness } from "../harness.js";
import { scopedName, toKebab } from "../names.js";
import {
  classifySkillFolder, deriveScope, readModels, removePackModels, resolvePackRef, serializeModels, skillFolderPath,
  type BlockedItem, type Lock, type PackConfig, type ProjectOp, type SelectionConfig,
} from "../project/index.js";
import { MODELS_FILE } from "../project/paths.js";
import { PackRefError } from "../project/pack-ref.js";
import { parseSourceSpec } from "../source/parse.js";
import { fetchPack, type LoadedPack } from "./fetch-pack.js";
import { planProjectInstall, type PackTarget, type ProjectInstallPlan } from "./project.js";

export class RemoveError extends Error {}

export type RemoveTarget =
  | { kind: "pack"; key: string }
  | { kind: "skill"; key: string; /** Folder name in .agents/skills. */ folder: string }
  | { kind: "agent"; key: string; /** Agent name as written in skillpack.json. */ agent: string };

interface Ctx {
  projectDir: string;
  config: SelectionConfig;
  lock: Lock | null;
}

const folderNames = (lock: Lock | null, key: string): string[] => Object.keys(lock?.packs[key]?.skills ?? {}).map((p) => p.split("/").pop()!);

/**
 * Resolves what the user typed for `remove` (R-CLI-7, R-SAF-3). In order: a pack (scope or source);
 * `<pack>/<name>`; a bare name, matched against the installed skills (plain name or folder name) and
 * the configured agents (plain or scoped name) of every pack. `skill:<name>` / `agent:<name>` pick
 * the kind when a name is both.
 */
export function resolveRemoveTarget(ref: string, ctx: Ctx): RemoveTarget {
  const scopesOf = (k: string) => deriveScope(ctx.projectDir, ctx.config, ctx.lock, k);
  const kindMatch = /^(skill|agent):(.+)$/.exec(ref);
  const kind = kindMatch ? (kindMatch[1] as "skill" | "agent") : null;
  const rest = kindMatch ? kindMatch[2]! : ref;

  if (!kind) {
    try {
      return { kind: "pack", key: resolvePackRef(ctx.config, rest, scopesOf) };
    } catch (e) {
      if (!(e instanceof PackRefError)) throw e;
      if (/more than one pack/.test(e.message)) throw new RemoveError(e.message);
    }
  }

  let only: string | null = null;
  let name = rest;
  const slash = rest.lastIndexOf("/");
  if (slash > 0) {
    try {
      only = resolvePackRef(ctx.config, rest.slice(0, slash), scopesOf);
      name = rest.slice(slash + 1);
    } catch {
      // not a qualified name: keep matching the whole text
    }
  }
  const nm = toKebab(name);
  const found: RemoveTarget[] = [];
  for (const key of only ? [only] : Object.keys(ctx.config.packs)) {
    const info = scopesOf(key);
    if (kind !== "agent") {
      for (const f of folderNames(ctx.lock, key)) {
        const hit = f === nm || info.candidates.some((c) => f === `${c}-${nm}`) || (info.candidates.length === 0 && f.endsWith(`-${nm}`));
        if (hit) found.push({ kind: "skill", key, folder: f });
      }
    }
    if (kind !== "skill") {
      for (const a of Object.keys(ctx.config.packs[key]!.agents)) {
        if (a === name || toKebab(a) === nm || info.candidates.some((c) => `${c}-${toKebab(a)}` === nm)) found.push({ kind: "agent", key, agent: a });
      }
    }
  }
  if (found.length === 0) throw new RemoveError(`nothing named "${ref}" is installed (not a pack, skill or agent of the configured packs)`);
  if (found.length > 1) {
    const packs = new Set(found.map((f) => f.key));
    if (packs.size > 1) {
      const hints = [...packs].map((k) => `${scopesOf(k).best ?? k}/${name}`).join(" or ");
      throw new RemoveError(`"${ref}" matches more than one pack (${[...packs].join(", ")}); qualify it with the pack: ${hints}`);
    }
    throw new RemoveError(`"${ref}" is both a skill and an agent of ${found[0]!.key}; use skill:${name} or agent:${name}`);
  }
  return found[0]!;
}

export interface RemoveInput {
  projectDir: string;
  cliVersion: string;
  config: SelectionConfig;
  lock: Lock | null;
  targets: RemoveTarget[];
  /** `-a`: harnesses an agent removal applies to; empty = all of the pack's. */
  harnesses: Harness[];
  detected: readonly Harness[];
  force?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface RemovePlan extends ProjectInstallPlan {
  /** Project-relative paths this plan deletes. */
  deletedSkills: string[];
  deletedAgents: string[];
  /** Packs fetched at their locked commit to learn skill names or re-render skills. */
  fetched: string[];
  /** The config that will be written. */
  newConfig: SelectionConfig;
}

/**
 * Plans `remove` for packs, skills and agents in ONE transaction, offline except where it needs
 * the pack source (an agent binding changes how skills render; a `"*"` skill list needs the source
 * names): then the pack is fetched at its locked commit. Edited skill folders and agent files are
 * kept unless `force`; if any are kept, the plan is blocked and nothing is written.
 */
export async function planRemove(i: RemoveInput): Promise<RemovePlan> {
  const { projectDir, lock } = i;
  const removedPacks = new Set(i.targets.filter((t) => t.kind === "pack").map((t) => t.key));
  const skillT = new Map<string, string[]>();
  const agentT = new Map<string, string[]>();
  for (const t of i.targets) {
    if (t.kind === "skill" && !removedPacks.has(t.key)) skillT.set(t.key, [...(skillT.get(t.key) ?? []), t.folder]);
    if (t.kind === "agent" && !removedPacks.has(t.key)) agentT.set(t.key, [...(agentT.get(t.key) ?? []), t.agent]);
  }

  const newConfig: SelectionConfig = { ...i.config, packs: { ...i.config.packs } };
  for (const k of removedPacks) delete newConfig.packs[k];

  const targets: PackTarget[] = [];
  const extraOps: ProjectOp[] = [];
  const extraBlocked: BlockedItem[] = [];
  const manualDrops: { key: string; path: string }[] = [];
  const fetched: string[] = [];

  for (const key of new Set([...skillT.keys(), ...agentT.keys()])) {
    const cfg: PackConfig = structuredClone(i.config.packs[key]!);
    const entry = lock?.packs[key];
    const needFetch = agentT.has(key) || (skillT.has(key) && cfg.skills === "*");
    let pack: LoadedPack | null = null;
    if (needFetch) {
      if (!entry) throw new RemoveError(`${key} isn't installed (it is not in the lock file); run skillpack install first`);
      pack = (await fetchPack(parseSourceSpec(key), {
        requested: cfg.version,
        locked: { commit: entry.commit, ref: entry.ref },
        cliVersion: i.cliVersion,
        ...(i.env ? { env: i.env } : {}),
      })).pack;
      fetched.push(key);
    }
    const scope = cfg.scope ?? pack?.name ?? deriveScope(projectDir, i.config, lock, key).best;

    const drop = skillT.get(key);
    if (drop) {
      if (!scope) throw new RemoveError(`can't tell which skills of ${key} are installed; run skillpack install first`);
      const names = cfg.skills === "*" ? pack!.skills.map((s) => s.name) : cfg.skills;
      const gone = new Set(drop);
      const remaining = names.filter((n) => !gone.has(scopedName(scope, n)));
      if (remaining.length === names.length) throw new RemoveError(`couldn't match ${drop.join(", ")} to a skill name in ${key}`);
      if (remaining.length === 0) throw new RemoveError(`removing ${drop.join(", ")} would leave ${key} without skills; remove the pack instead`);
      cfg.skills = remaining;
      if (!agentT.has(key)) {
        for (const folder of drop) {
          const path = skillFolderPath(folder);
          const { state } = classifySkillFolder(projectDir, path, lock);
          manualDrops.push({ key, path });
          if (state === "owned-clean" || (state === "owned-edited" && i.force)) extraOps.push({ type: "delete-skill-folder", path });
          else if (state === "owned-edited") extraBlocked.push({ path, kind: "skill", action: "delete", reason: "edited", pack: key });
        }
      }
    }

    const selected: Harness[] = [];
    if (agentT.has(key)) {
      for (const h of i.harnesses) {
        if (!cfg.harnesses.includes(h)) throw new RemoveError(`-a ${h}: ${key} isn't installed for ${h}`);
      }
      selected.push(...(i.harnesses.length > 0 ? i.harnesses : cfg.harnesses));
      for (const a of agentT.get(key)!) {
        const per = { ...(cfg.agents[a] ?? {}) };
        for (const h of selected) per[h] = "none";
        cfg.agents[a] = per;
      }
      targets.push({
        key,
        pack: pack!,
        resolved: { ref: entry!.ref, commit: entry!.commit },
        packConfig: cfg,
        scope: scope!,
        agentHarnesses: HARNESSES.filter((h) => cfg.harnesses.includes(h) && (i.detected.includes(h) || selected.includes(h))),
      });
    }
    newConfig.packs[key] = cfg;
  }

  const modelsFile = join(projectDir, MODELS_FILE);
  const models = readModels(projectDir);
  if (models.status === "ok" && [...removedPacks].some((k) => k in models.value.packs)) {
    for (const k of removedPacks) removePackModels(models.value, k);
    extraOps.push({ type: "write-json", path: MODELS_FILE, content: serializeModels(models.value), label: "models" });
  }

  const plan = await planProjectInstall({
    projectDir,
    cliVersion: i.cliVersion,
    config: newConfig,
    lock,
    targets,
    removeKeys: [...removedPacks],
    writeConfig: true,
    force: i.force ?? false,
    restoreEdited: false,
    blockOnAgents: true,
    deleteEditedOnRemove: false,
    pruneExclude: true,
    ...(existsSync(modelsFile) ? {} : { excludeRemove: [MODELS_FILE] }),
    lockEdit: (l) => {
      for (const d of manualDrops) delete l.packs[d.key]?.skills[d.path];
    },
    extraOps,
    extraBlocked,
    ...(i.env ? { env: i.env } : {}),
  });
  return {
    ...plan,
    deletedSkills: plan.ops.filter((o) => o.type === "delete-skill-folder").map((o) => o.path),
    deletedAgents: plan.ops.filter((o) => o.type === "delete-file" && o.label === "agent").map((o) => o.path),
    fetched,
    newConfig,
  };
}

