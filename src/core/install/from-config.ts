import { GitError } from "../git/index.js";
import type { Harness } from "../harness.js";
import { overlongScopedNames } from "../names.js";
import { listAgentSources, type Lock, type PackConfig, type SelectionConfig } from "../project/index.js";
import { parseSourceSpec } from "../source/parse.js";
import { lockSatisfies, VersionError } from "../source/versions.js";
import { fetchPack } from "./fetch-pack.js";
import { InstallError } from "./select.js";
import type { PackTarget, ProjectInstallPlan } from "./project.js";

export { GitError, VersionError };

/** How a configured pack relates to the lock file, decided without network access. */
export type LockState = "locked" | "unsatisfied" | "missing";

export function lockStates(config: SelectionConfig, lock: Lock | null): Map<string, LockState> {
  const out = new Map<string, LockState>();
  for (const [key, cfg] of Object.entries(config.packs)) {
    const locked = lock?.packs[key];
    out.set(key, !locked ? "missing" : lockSatisfies(cfg.version, locked) ? "locked" : "unsatisfied");
  }
  return out;
}

/** Locked packs that skillpack.json no longer lists. */
export const removedKeys = (config: SelectionConfig, lock: Lock | null): string[] =>
  Object.keys(lock?.packs ?? {}).filter((k) => !(k in config.packs));

/**
 * Packs to remove on install: locked packs no longer configured, plus packs whose generated agent
 * files are still around (found by header) although neither the config nor the lock lists them.
 */
export function packsToRemove(projectDir: string, config: SelectionConfig, lock: Lock | null): string[] {
  const keys = new Set(removedKeys(config, lock));
  for (const src of listAgentSources(projectDir)) if (!(src in config.packs) && !(src in (lock?.packs ?? {}))) keys.add(src);
  return [...keys];
}

export interface PackStatus {
  key: string;
  name: string;
  /** locked: installed at the locked commit; re-resolved: the lock no longer satisfied `version`; resolved: not in the lock yet. */
  kind: "locked" | "re-resolved" | "resolved";
  tag: string | null;
  commit: string;
  requested: string;
  /** Configured harnesses without a detected install: no agents generated for them. */
  skippedHarnesses: Harness[];
}

/**
 * Fetches every configured pack (R-VER-6): at the locked commit when the lock still satisfies the
 * requested version, otherwise resolved again. Nothing is written.
 */
export async function prepareTargets(o: {
  config: SelectionConfig;
  lock: Lock | null;
  detected: readonly Harness[];
  /** Generate agents for no harness (frozen-lockfile checks). */
  noAgents?: boolean;
  env?: NodeJS.ProcessEnv;
  cliVersion: string;
}): Promise<{ targets: PackTarget[]; statuses: PackStatus[] }> {
  const states = lockStates(o.config, o.lock);
  const targets: PackTarget[] = [];
  const statuses: PackStatus[] = [];
  for (const [key, cfg] of Object.entries(o.config.packs)) {
    const state = states.get(key)!;
    const locked = o.lock?.packs[key];
    const spec = parseSourceSpec(key);
    const fetched = await fetchPack(spec, {
      requested: cfg.version,
      cliVersion: o.cliVersion,
      ...(o.env ? { env: o.env } : {}),
      ...(state === "locked" && locked ? { locked: { commit: locked.commit, tag: locked.version } } : {}),
    });
    const { pack, resolved } = fetched;
    const scope = cfg.scope ?? pack.name;
    checkPackConfig(key, cfg, pack.skills.map((s) => s.name), pack.agents.map((a) => a.name), pack.harnesses, scope);
    const agentHarnesses = o.noAgents ? [] : cfg.harnesses.filter((h) => o.detected.includes(h));
    targets.push({ key, pack, resolved: { tag: resolved.tag, commit: resolved.commit }, packConfig: cfg, scope, agentHarnesses });
    statuses.push({
      key,
      name: pack.name,
      kind: state === "locked" ? "locked" : state === "unsatisfied" ? "re-resolved" : "resolved",
      tag: resolved.tag,
      commit: resolved.commit,
      requested: cfg.version,
      skippedHarnesses: o.noAgents ? [] : cfg.harnesses.filter((h) => !o.detected.includes(h)),
    });
  }
  return { targets, statuses };
}

function checkPackConfig(key: string, cfg: PackConfig, skills: string[], agents: string[], supported: Harness[] | null, scope: string): void {
  if (cfg.skills !== "*") {
    const missing = cfg.skills.filter((n) => !skills.includes(n));
    if (missing.length > 0) throw new InstallError(`${key}: skillpack.json lists skills the pack doesn't have: ${missing.join(", ")}`);
  }
  if (supported) {
    const bad = cfg.harnesses.filter((h) => !supported.includes(h));
    if (bad.length > 0) throw new InstallError(`${key}: the pack doesn't support the configured harness ${bad.join(", ")}`);
  }
  const names = cfg.skills === "*" ? skills : cfg.skills;
  const long = overlongScopedNames(scope, [...names, ...agents]);
  if (long.length > 0) throw new InstallError(`${key}: installed names too long (max 64): ${long.join(", ")}`);
}

/**
 * Problems for `--frozen-lockfile`: packs missing from the lock or no longer satisfied, locked packs
 * missing from the config (all found without network access).
 */
export function lockfileProblems(config: SelectionConfig, lock: Lock | null): string[] {
  const out: string[] = [];
  for (const [key, state] of lockStates(config, lock)) {
    if (state === "missing") out.push(`${key} is in skillpack.json but not in the lock file`);
    else if (state === "unsatisfied") {
      out.push(`${key}: locked ${lock!.packs[key]!.version ?? lock!.packs[key]!.commit.slice(0, 7)} doesn't satisfy "${config.packs[key]!.version}"`);
    }
  }
  for (const key of removedKeys(config, lock)) out.push(`${key} is in the lock file but not in skillpack.json`);
  return out;
}

/** Problems for `--frozen-lockfile` found by rendering the locked commits: skill folders and hashes that differ. */
export function frozenSkillProblems(plan: ProjectInstallPlan, lock: Lock | null): string[] {
  const out: string[] = [];
  for (const c of plan.conflicts) out.push(c);
  for (const b of plan.blocked) out.push(`${b.path} can't be written (${b.reason === "foreign" ? "not installed by skillpack" : b.reason})`);
  const seen = new Set<string>();
  const describe = {
    added: "is not in the lock file but would be installed",
    restored: "is missing or was edited",
    updated: "differs from what the locked commit renders",
    removed: "is no longer part of the configured skills",
  } as const;
  for (const a of plan.skillActions) {
    seen.add(a.path);
    out.push(`${a.path} ${describe[a.action]}`);
  }
  for (const [key, entry] of Object.entries(plan.newLock.packs)) {
    const was = lock?.packs[key]?.skills ?? {};
    for (const path of new Set([...Object.keys(was), ...Object.keys(entry.skills)])) {
      if (!seen.has(path) && was[path] !== entry.skills[path]) out.push(`${path}: the lock file's hash doesn't match what the locked commit renders`);
    }
  }
  return out;
}
