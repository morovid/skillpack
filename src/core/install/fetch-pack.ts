import { existsSync } from "node:fs";
import { join } from "node:path";
import { toAgentSpec, type AgentSpec } from "../agents/index.js";
import type { Diagnostic } from "../diagnostics.js";
import { parseFrontmatter } from "../frontmatter.js";
import { readTree, type TreeFile } from "../fs/tree.js";
import { fetchCommit, lsRemote, withTempCheckout } from "../git/index.js";
import { HARNESSES, type Harness } from "../harness.js";
import { MANIFEST_FILE } from "../paths.js";
import { listSkillSources, loadAgentDefinitions, loadPackManifest } from "../pack/index.js";
import type { SourceSpec } from "../source/parse.js";
import { resolveVersion, type ResolvedVersion } from "../source/versions.js";
import { validatePack } from "../../commands/validate/validate-pack.js";

export class PackError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message);
    this.name = "PackError";
  }
}

export interface LoadedSkill {
  name: string;
  description: string;
  files: TreeFile[];
}

/** A whole pack read into memory, so the temporary checkout can be deleted right away. */
export interface LoadedPack {
  name: string;
  description?: string;
  cli?: string;
  /** Harnesses the manifest restricts the pack to, or null for all. */
  harnesses: Harness[] | null;
  skills: LoadedSkill[];
  agents: AgentSpec[];
  /** Validation warnings. */
  warnings: Diagnostic[];
}

/** Reads and validates a pack folder (validate checks, including the manifest's `cli` range, R-VER-1b). */
export function loadPack(dir: string, cliVersion: string): LoadedPack {
  if (!existsSync(join(dir, MANIFEST_FILE))) {
    throw new PackError(
      `The repository has no ${MANIFEST_FILE}. Packs without a manifest (installed through npx skills discovery) aren't supported yet.`,
    );
  }
  const v = validatePack(dir, { cliVersion });
  if (v.diagnostics.errorCount > 0) throw new PackError("The pack is invalid", v.diagnostics.items);
  const manifest = loadPackManifest(dir).result;
  const m = (manifest.ok ? manifest.value : {}) as { name: string; description?: string; cli?: string; harnesses?: Harness[] };
  const skills = listSkillSources(dir)
    .filter((s) => s.skillFile !== null)
    .map((s): LoadedSkill => {
      const fm = parseFrontmatter(s.skillText ?? "");
      const description = fm.kind === "ok" && typeof fm.data.description === "string" ? fm.data.description : "";
      return { name: s.name, description, files: readTree(s.dir) };
    });
  const pack: LoadedPack = {
    name: m.name,
    harnesses: m.harnesses ? HARNESSES.filter((h) => m.harnesses!.includes(h)) : null,
    skills,
    agents: loadAgentDefinitions(dir).map(toAgentSpec),
    warnings: v.diagnostics.items.filter((d) => d.level === "warning"),
  };
  if (m.description !== undefined) pack.description = m.description;
  if (m.cli !== undefined) pack.cli = m.cli;
  return pack;
}

export interface FetchedPack {
  resolved: ResolvedVersion;
  pack: LoadedPack;
}

/**
 * Resolves the version, fetches the commit into a temporary folder, loads the pack into memory and
 * deletes the folder (R-SRC-5: no cache). With `locked`, the commit is used as is (install, sync).
 */
export async function fetchPack(
  spec: SourceSpec,
  opts: { requested?: string | undefined; locked?: { commit: string; tag: string | null; branch?: string | null }; env?: NodeJS.ProcessEnv; cliVersion: string },
): Promise<FetchedPack> {
  const git = opts.env ? { env: opts.env } : {};
  let resolved: ResolvedVersion;
  if (opts.locked) {
    resolved = { kind: opts.locked.tag ? "tag" : opts.locked.branch ? "branch" : "commit", tag: opts.locked.tag, commit: opts.locked.commit, saved: opts.requested ?? opts.locked.commit };
  } else {
    resolved = resolveVersion(opts.requested ?? spec.version, await lsRemote(spec.cloneUrl, git));
  }
  return withTempCheckout(async (dir) => {
    const commit = await fetchCommit(spec.cloneUrl, resolved.commit, dir, git);
    return { resolved: { ...resolved, commit }, pack: loadPack(dir, opts.cliVersion) };
  });
}

/** The branch to record in the lock file: set when the version resolved from a branch (`saved` is its name). */
export const resolvedBranch = (r: ResolvedVersion): string | null => (r.kind === "branch" ? r.saved : null);
