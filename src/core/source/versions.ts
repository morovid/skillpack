import semver from "semver";
import type { RemoteRefs } from "../git/index.js";

export type Remote = Pick<RemoteRefs, "tags" | "branches" | "head">;

export interface ResolvedVersion {
  kind: "tag" | "branch" | "commit";
  tag: string | null;
  commit: string;
  /** Value for `version` in skillpack.json. */
  saved: string;
}

/** The git ref to record in the lock file: `refs/tags/<tag>`, `refs/heads/<branch>`, or null for a commit pin. */
export function resolvedRef(r: ResolvedVersion): string | null {
  return r.kind === "tag" && r.tag ? `refs/tags/${r.tag}` : r.kind === "branch" ? `refs/heads/${r.saved}` : null;
}

export interface SemverTag {
  tag: string;
  version: string;
  commit: string;
}

export class VersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionError";
  }
}

/** Semver tags (`v1.2.3` or `1.2.3`), the `v` form winning when both exist; sorted ascending. */
export function semverTags(remote: Remote): SemverTag[] {
  const byVersion = new Map<string, SemverTag>();
  for (const [tag, commit] of remote.tags) {
    const v = semver.valid(tag);
    if (!v) continue;
    const prev = byVersion.get(v);
    if (!prev || (tag.startsWith("v") && !prev.tag.startsWith("v"))) byVersion.set(v, { tag, version: v, commit });
  }
  return [...byVersion.values()].sort((a, b) => semver.compare(a.version, b.version));
}

function highest(tags: SemverTag[], range: string): SemverTag | null {
  const hits = tags.filter((t) => semver.satisfies(t.version, range));
  return hits.length ? hits[hits.length - 1]! : null;
}

/** Highest tag satisfying `range` (npm prerelease rules), for `update`. */
export function latestInRange(range: string, remote: Remote): SemverTag | null {
  if (!semver.validRange(range)) return null;
  return highest(semverTags(remote), range);
}

/** Highest stable semver tag (prereleases only with `includePrerelease`), for `upgrade`/`check`. */
export function latestOverall(remote: Remote, options: { includePrerelease?: boolean } = {}): SemverTag | null {
  const tags = semverTags(remote).filter((t) => options.includePrerelease || !semver.prerelease(t.version));
  return tags.length ? tags[tags.length - 1]! : null;
}

function describeAvailable(remote: Remote): string {
  const tags = semverTags(remote).slice(-5).map((t) => t.tag).reverse();
  const parts: string[] = [];
  if (tags.length) parts.push(`versions: ${tags.join(", ")}`);
  else parts.push("no semver tags");
  const branches = [...remote.branches.keys()].slice(0, 5);
  if (branches.length) parts.push(`branches: ${branches.join(", ")}`);
  return `Available: ${parts.join("; ")}`;
}

/**
 * Resolves a requested version (R-VER-2, R-VER-3). Order: semver version/range, tag name, branch name, commit sha.
 * Abbreviated shas (7-39 hex) can't be resolved through ls-remote: they come back as kind "commit" with the sha as given,
 * and the fetch step resolves them (fetchCommit returns the full sha).
 */
export function resolveVersion(requested: string | undefined, remote: Remote): ResolvedVersion {
  if (requested === undefined) {
    const latest = latestOverall(remote);
    if (latest) return { kind: "tag", tag: latest.tag, commit: latest.commit, saved: `^${latest.version}` };
    const branch = remote.head.branch;
    if (!branch) throw new VersionError("The repository has no semver tags and its default branch couldn't be determined; pass @<version>");
    return { kind: "branch", tag: null, commit: remote.branches.get(branch) ?? remote.head.sha, saved: branch };
  }
  const req = requested.trim();
  if (!req) throw new VersionError("The requested version is empty");

  if (semver.validRange(req)) {
    const hit = highest(semverTags(remote), req);
    if (hit) return { kind: "tag", tag: hit.tag, commit: hit.commit, saved: req };
  }
  const tagSha = remote.tags.get(req);
  if (tagSha) return { kind: "tag", tag: req, commit: tagSha, saved: req };
  const branchSha = remote.branches.get(req);
  if (branchSha) return { kind: "branch", tag: null, commit: branchSha, saved: req };
  if (/^[0-9a-f]{7,40}$/i.test(req)) return { kind: "commit", tag: null, commit: req.toLowerCase(), saved: req };

  throw new VersionError(`No version, tag, branch or commit matches "${req}". ${describeAvailable(remote)}`);
}

const SHA_LIKE = /^[0-9a-f]{7,40}$/i;

/**
 * Does the locked entry still satisfy the requested version in skillpack.json (R-VER-6)? Decided
 * without network access from the locked `ref` and `commit`:
 *
 * - semver version or range: the ref is `refs/tags/<t>` where `t` is a semver tag inside it
 *   (npm prerelease rules; `v` prefix optional);
 * - 7-40 hex digits: the locked commit starts with it;
 * - anything else: the ref is `refs/tags/<requested>` or `refs/heads/<requested>`, so a tag and a
 *   branch can both be requested by name, and switching branch (`main` to `dev`) is noticed.
 */
export function lockSatisfies(requested: string, locked: { ref: string | null; commit: string }): boolean {
  const req = requested.trim();
  if (!req) return false;
  const sha = SHA_LIKE.test(req) && locked.commit.toLowerCase().startsWith(req.toLowerCase());
  if (semver.validRange(req)) {
    const tag = locked.ref?.startsWith("refs/tags/") ? locked.ref.slice("refs/tags/".length) : null;
    return (tag !== null && !!semver.valid(tag) && semver.satisfies(tag, req)) || sha;
  }
  if (sha) return true;
  return locked.ref === `refs/tags/${req}` || locked.ref === `refs/heads/${req}`;
}

export type RewriteResult = { version: string; reason?: undefined } | { version: null; reason: string };

/** Rewrites a saved `version` for `upgrade` (R-VER-7a), keeping its form. `newVersion` may be a tag name or a version. */
export function rewriteRange(old: string, newVersion: string): RewriteResult {
  const target = semver.valid(newVersion);
  if (!target) return { version: null, reason: `"${newVersion}" is not a semver version` };
  const o = old.trim();
  if (semver.valid(o)) return { version: o.startsWith("v") ? `v${target}` : target };
  if (/^[\^~]\s*v?\d[\w.+-]*$/.test(o) && semver.validRange(o)) return { version: `${o[0]}${target}` };
  if (semver.validRange(o)) return { version: `^${target}` };
  return { version: null, reason: `"${old}" follows a branch or is pinned to a commit or non-semver tag` };
}
