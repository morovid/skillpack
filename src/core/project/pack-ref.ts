import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseAgentHeader } from "../agents/header.js";
import type { Harness } from "../harness.js";
import { toKebab } from "../names.js";
import { matchesPackRef } from "../source/parse.js";
import type { PackConfig, SelectionConfig } from "./config.js";
import { classifyAgentFile, classifySkillFolder, findOwnedAgentFiles } from "./ownership.js";
import type { Lock } from "./lock.js";
import { AGENT_EXT, agentFilePath } from "./paths.js";
import { HARNESSES } from "../harness.js";

export class PackRefError extends Error {}

export interface ScopeInfo {
  /** The best guess, or null when nothing in the project tells. */
  best: string | null;
  /** True when `best` is certain (an `--as` override, or derived from a name that is known exactly). */
  exact: boolean;
  /** Every scope the pack could have; a ref matches if it equals one of them. */
  candidates: string[];
}

/** All prefixes of `name` that end just before a `-`: `a-b-c` gives `a`, `a-b`. */
const dashPrefixes = (name: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < name.length; i++) if (name[i] === "-" && i > 0) out.push(name.slice(0, i));
  return out;
};

const commonPrefix = (names: string[]): string => {
  let p = names[0] ?? "";
  for (const n of names.slice(1)) while (!n.startsWith(p)) p = p.slice(0, -1);
  return p;
};

/**
 * The manifest name (= default scope) isn't stored in skillpack.json, so it is derived offline.
 * In order of certainty:
 *  1. an `--as` override in the config is the scope (exact);
 *  2. a locked skill folder `<scope>-<kebab(name)>` whose `name` is listed in `skills` gives the
 *     scope by removing the known suffix (exact), and so does a generated agent file, whose header
 *     names the agent: `<scope>-<kebab(agent)>` (exact);
 *  3. otherwise, from the locked skill folders alone: the longest common prefix of all folder names,
 *     cut at a `-` boundary, is the best guess; with a single folder the first dash-separated
 *     segment is. Every `-` boundary prefix of the common prefix is a candidate, so a ref such as
 *     `my-pack` still matches when the best guess is `my-pack-plan`.
 */
export function deriveScope(projectDir: string, config: SelectionConfig, lock: Lock | null, key: string): ScopeInfo {
  const cfg = config.packs[key];
  if (cfg?.scope) return { best: cfg.scope, exact: true, candidates: [cfg.scope] };

  const folders = Object.keys(lock?.packs[key]?.skills ?? {}).map((p) => basename(p));
  if (cfg && cfg.skills !== "*") {
    for (const f of folders) {
      for (const n of cfg.skills) {
        const suffix = `-${toKebab(n)}`;
        if (f.endsWith(suffix) && f.length > suffix.length) {
          const scope = f.slice(0, -suffix.length);
          return { best: scope, exact: true, candidates: [scope] };
        }
      }
    }
  }
  for (const path of findOwnedAgentFiles(projectDir, key)) {
    const h = HARNESSES.find((x) => path.startsWith(`.${x}/`));
    if (!h) continue;
    try {
      const header = parseAgentHeader(readFileSync(join(projectDir, path), "utf8"));
      const id = basename(path, AGENT_EXT[h]);
      const suffix = `-${toKebab(header?.agent ?? "")}`;
      if (header && id.endsWith(suffix) && id.length > suffix.length) {
        const scope = id.slice(0, -suffix.length);
        return { best: scope, exact: true, candidates: [scope] };
      }
    } catch {
      // unreadable: ignore
    }
  }

  if (folders.length === 0) return { best: null, exact: false, candidates: [] };
  if (folders.length === 1) {
    const candidates = dashPrefixes(folders[0]!);
    return candidates.length > 0 ? { best: candidates[0]!, exact: false, candidates } : { best: null, exact: false, candidates: [] };
  }
  const cut = commonPrefix(folders).lastIndexOf("-");
  if (cut <= 0) return { best: null, exact: false, candidates: [] };
  const best = commonPrefix(folders).slice(0, cut);
  return { best, exact: false, candidates: [...dashPrefixes(best), best] };
}

/**
 * R-CLI-7: finds the configured pack a user-typed ref names. A ref is a source (`owner/repo`, a
 * URL) or a scope. Throws with the configured packs listed when nothing matches, and with the
 * candidates listed when more than one pack does.
 */
export function resolvePackRef(config: SelectionConfig, ref: string, scopesOf: (key: string) => ScopeInfo): string {
  const matches = Object.keys(config.packs).filter((key) => {
    const info = scopesOf(key);
    return matchesPackRef(ref, key, "") || info.candidates.some((sc) => matchesPackRef(ref, key, sc));
  });
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new PackRefError(`"${ref}" matches more than one pack: ${matches.join(", ")}; use the source instead`);
  }
  const known = Object.keys(config.packs).map((k) => `${k}${scopesOf(k).best ? ` (${scopesOf(k).best})` : ""}`);
  throw new PackRefError(
    known.length > 0 ? `no pack matches "${ref}". Configured packs: ${known.join(", ")}` : `no pack matches "${ref}"; no packs are configured`,
  );
}

export type FileStatus = "ok" | "edited" | "missing" | "foreign" | "not-detected" | "unknown";

export interface PackDescription {
  key: string;
  scope: string | null;
  scopeExact: boolean;
  explicitScope?: string;
  /** `version` from skillpack.json. */
  requested: string;
  /** From the lock file, or null when the pack isn't locked. */
  locked: { ref: string | null; commit: string } | null;
  harnesses: Harness[];
  skills: "*" | string[];
  /** agent -> harness -> binding text. */
  bindings: PackConfig["agents"];
  skillFolders: { path: string; status: "ok" | "edited" | "missing" }[];
  agentFiles: { agent: string; harness: Harness; path: string | null; status: FileStatus }[];
}

/** Everything `list` shows about one configured pack, from the config, the lock file and the disk (no network). */
export function describePack(
  projectDir: string,
  config: SelectionConfig,
  lock: Lock | null,
  key: string,
  detected: readonly Harness[] | null = null,
): PackDescription {
  const cfg = config.packs[key]!;
  const info = deriveScope(projectDir, config, lock, key);
  const entry = lock?.packs[key];
  const out: PackDescription = {
    key,
    scope: info.best,
    scopeExact: info.exact,
    requested: cfg.version,
    locked: entry ? { ref: entry.ref, commit: entry.commit } : null,
    harnesses: cfg.harnesses,
    skills: cfg.skills,
    bindings: cfg.agents,
    skillFolders: [],
    agentFiles: [],
  };
  if (cfg.scope) out.explicitScope = cfg.scope;
  for (const path of Object.keys(entry?.skills ?? {}).sort()) {
    const st = classifySkillFolder(projectDir, path, lock).state;
    out.skillFolders.push({ path, status: st === "absent" ? "missing" : st === "owned-clean" ? "ok" : "edited" });
  }
  for (const [agent, per] of Object.entries(cfg.agents)) {
    for (const h of cfg.harnesses) {
      if ((per[h] ?? "generate") !== "generate") continue;
      const path = info.exact && info.best ? agentFilePath(h, `${info.best}-${toKebab(agent)}`) : null;
      let status: FileStatus;
      if (path === null) status = "unknown";
      else {
        const st = classifyAgentFile(projectDir, path, key);
        status = st === "owned-clean" ? "ok" : st === "owned-edited" ? "edited" : st === "foreign" ? "foreign" : detected && !detected.includes(h) ? "not-detected" : "missing";
      }
      out.agentFiles.push({ agent, harness: h, path, status });
    }
  }
  return out;
}

/** Packs that are in the lock file but not in skillpack.json and that `ref` names (by source, or by a scope derived from their locked skill folders). */
export function findLockOnlyPacks(projectDir: string, config: SelectionConfig, lock: Lock | null, ref: string): string[] {
  return Object.keys(lock?.packs ?? {}).filter((key) => {
    if (key in config.packs) return false;
    const info = deriveScope(projectDir, config, lock, key);
    return matchesPackRef(ref, key, "") || info.candidates.some((sc) => matchesPackRef(ref, key, sc));
  });
}
