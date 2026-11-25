import semver from "semver";
import type { RemoteRefs } from "../git/index.js";
import { formatLockedRef, refTag } from "../project/lock.js";
import {
  latestOverall, resolveVersion, resolvedRef, rewriteRange, type ResolvedVersion,
} from "../source/versions.js";

type Remote = Pick<RemoteRefs, "tags" | "branches" | "head">;

export interface VersionTarget {
  /** The lock `ref`: `refs/tags/<tag>`, `refs/heads/<branch>`, or null for a commit. */
  ref: string | null;
  commit: string;
  /** `v1.1.0` or `main@abc1234`. */
  label: string;
  resolved: ResolvedVersion;
}

export type Choice =
  | {
      kind: "move";
      to: VersionTarget;
      /** `upgrade` only: the new `version` for skillpack.json, in the old one's form (R-VER-7a). */
      version?: string;
    }
  | { kind: "keep"; reason: "up-to-date" | "latest" | "pinned" | "not-applicable"; note: string };

const target = (r: ResolvedVersion): VersionTarget => {
  const ref = resolvedRef(r);
  return { ref, commit: r.commit, label: formatLockedRef(ref, r.commit), resolved: r };
};

const isRange = (req: string): boolean => !!semver.validRange(req) && !semver.valid(req);

/**
 * `update` (R-VER-7): the newest version within the requested range, `version` unchanged. A range
 * moves to its highest tag; a branch to its new tip; an exact version, a tag or a commit stays.
 */
export function chooseUpdate(requested: string, locked: { ref: string | null; commit: string }, remote: Remote): Choice {
  const res = resolveVersion(requested, remote);
  if (res.kind === "commit") return { kind: "keep", reason: "pinned", note: `pinned to commit ${requested}; nothing to update` };
  if (res.kind === "tag") {
    if (!isRange(requested)) return { kind: "keep", reason: "pinned", note: `pinned to ${requested}; nothing to update` };
    const lockedTag = refTag(locked.ref);
    const same = res.commit === locked.commit || (lockedTag && semver.valid(lockedTag) && res.tag && semver.valid(res.tag) && semver.lte(res.tag, lockedTag));
    return same ? { kind: "keep", reason: "up-to-date", note: "up to date" } : { kind: "move", to: target(res) };
  }
  return res.commit === locked.commit ? { kind: "keep", reason: "up-to-date", note: "up to date" } : { kind: "move", to: target(res) };
}

/**
 * `upgrade` (R-VER-7a): the highest semver tag overall (prereleases only with the option), with
 * `version` rewritten in its old form. Branches, commit pins and non-semver tags are left alone.
 */
export function chooseUpgrade(
  requested: string,
  locked: { ref: string | null; commit: string },
  remote: Remote,
  options: { includePrerelease?: boolean } = {},
): Choice {
  const form = rewriteRange(requested, "0.0.0"); // can this kind of version be rewritten at all?
  if (form.version === null) return { kind: "keep", reason: "not-applicable", note: `${form.reason}; upgrade leaves it alone` };
  const latest = latestOverall(remote, options);
  if (!latest) return { kind: "keep", reason: "not-applicable", note: "no semver tags to upgrade to" };
  const rw = rewriteRange(requested, latest.version);
  if (rw.version === null) {
    return { kind: "keep", reason: "not-applicable", note: `${rw.reason}; upgrade leaves it alone` };
  }
  const lockedTag = refTag(locked.ref);
  if ((lockedTag && semver.valid(lockedTag) && semver.gte(lockedTag, latest.version)) || latest.commit === locked.commit) {
    return { kind: "keep", reason: "latest", note: "already the latest version" };
  }
  const resolved: ResolvedVersion = { kind: "tag", tag: latest.tag, commit: latest.commit, saved: rw.version };
  return { kind: "move", to: target(resolved), version: rw.version };
}
