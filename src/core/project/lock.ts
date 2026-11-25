import { join } from "node:path";
import { LOCK_FILE, SCHEMA_BASE } from "./paths.js";
import { readValidated, sortedEntries, toJsonText, type FileState } from "./io.js";

export interface LockedPack {
  /** The resolved tag, or null for a branch, commit or pack without tags. */
  version: string | null;
  /** The branch the pack was resolved from (a request for a branch, or the default branch of a pack without tags); null otherwise. Missing in lock files written before it existed. */
  branch?: string | null;
  commit: string;
  /** ".agents/skills/<folder>" -> "sha256-<hex>" */
  skills: Record<string, string>;
}

export interface Lock {
  /** skillpack version that wrote the hashes. */
  cli: string;
  packs: Record<string, LockedPack>;
}

export const emptyLock = (cli: string): Lock => ({ cli, packs: {} });

export function readLock(projectDir: string): FileState<Lock> {
  return readValidated(join(projectDir, LOCK_FILE), LOCK_FILE, "lock", false, (doc) => doc as unknown as Lock);
}

/** Deterministic text: packs and skills sorted by key. */
export function serializeLock(lock: Lock): string {
  const packs: Record<string, unknown> = {};
  for (const [key, p] of sortedEntries(lock.packs)) {
    packs[key] = { version: p.version, branch: p.branch ?? null, commit: p.commit, skills: Object.fromEntries(sortedEntries(p.skills)) };
  }
  return toJsonText({ $schema: `${SCHEMA_BASE}/lock.json`, cli: lock.cli, packs });
}

/** Which pack lists this skill folder path, if any. */
export function lockOwner(lock: Lock | null, skillPath: string): string | null {
  if (!lock) return null;
  for (const [key, p] of Object.entries(lock.packs)) if (skillPath in p.skills) return key;
  return null;
}
