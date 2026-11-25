import semver from "semver";
import type { RemoteRefs } from "../git/index.js";
import { chooseUpdate, chooseUpgrade, type VersionTarget } from "./version-choice.js";

type Remote = Pick<RemoteRefs, "tags" | "branches" | "head">;

export interface PackCheck {
  /** Newer within the requested range (for `update`). */
  update: VersionTarget | null;
  /** Newer outside the requested range (for `upgrade`). */
  upgrade: VersionTarget | null;
  /** Why there's no upgrade, or other remarks. */
  notes: string[];
}

/**
 * R-VER-7: what `update` and `upgrade` would do for a pack, from the remote's refs alone. `upgrade`
 * is only reported for a version that does NOT satisfy the requested range (a tag the range
 * accepts is `update`'s); packs that follow a branch or a commit have no upgrade.
 */
export function checkPack(requested: string, locked: { ref: string | null; commit: string }, remote: Remote, options: { includePrerelease?: boolean } = {}): PackCheck {
  const notes: string[] = [];
  const u = chooseUpdate(requested, locked, remote);
  const g = chooseUpgrade(requested, locked, remote, options);
  const update = u.kind === "move" ? u.to : null;
  let upgrade: VersionTarget | null = null;
  if (g.kind === "move") {
    const tag = g.to.resolved.tag;
    const inRange = tag !== null && !!semver.valid(tag) && !!semver.validRange(requested) && semver.satisfies(tag, requested);
    upgrade = inRange ? null : g.to;
  } else if (g.reason === "not-applicable") notes.push(g.note);
  if (u.kind === "keep" && u.reason === "pinned" && g.kind !== "move") notes.push(u.note);
  return { update, upgrade, notes };
}
