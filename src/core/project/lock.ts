import { join } from "node:path";
import { LOCK_FILE, SCHEMA_BASE } from "./paths.js";
import { readValidated, sortedEntries, toJsonText, type FileState } from "./io.js";

export interface LockedPack {
  /** The full git ref the commit was resolved from (`refs/tags/<tag>` or `refs/heads/<branch>`), or null for a commit pin. */
  ref: string | null;
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
    packs[key] = { ref: p.ref, commit: p.commit, skills: Object.fromEntries(sortedEntries(p.skills)) };
  }
  return toJsonText({ $schema: `${SCHEMA_BASE}/lock.json`, cli: lock.cli, packs });
}

/** Which pack lists this skill folder path, if any. */
export function lockOwner(lock: Lock | null, skillPath: string): string | null {
  if (!lock) return null;
  for (const [key, p] of Object.entries(lock.packs)) if (skillPath in p.skills) return key;
  return null;
}

/** `v1.0.0` for a tag, `main@10a4d94` for a branch, `10a4d94` for a commit pin. */
export function formatLockedRef(ref: string | null, commit: string): string {
  const short = commit.slice(0, 7);
  if (ref === null) return short;
  if (ref.startsWith("refs/tags/")) return ref.slice("refs/tags/".length);
  if (ref.startsWith("refs/heads/")) return `${ref.slice("refs/heads/".length)}@${short}`;
  return `${ref}@${short}`;
}

/** The tag of a `refs/tags/<tag>` ref, else null. */
export const refTag = (ref: string | null): string | null => (ref?.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : null);
/** The branch of a `refs/heads/<branch>` ref, else null. */
export const refBranch = (ref: string | null): string | null => (ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null);
