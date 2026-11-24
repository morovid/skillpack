import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { applyFsChanges, type FsChange, type TransactionHooks } from "../fs/atomic.js";
import { diffFiles } from "../fs/diff.js";
import { readTree, type TreeFile } from "../fs/tree.js";
import { hashFiles } from "../hash.js";
import type { Lock } from "./lock.js";
import { classifyAgentFile, classifySkillFolder, findOwnedAgentFiles } from "./ownership.js";

/** Paths are relative to the project root, or absolute (e.g. a worktree-shared `.git/info/exclude`). */
export type ProjectOp =
  | { type: "write-skill-folder"; path: string; files: TreeFile[] }
  | { type: "delete-skill-folder"; path: string }
  | { type: "write-file"; path: string; content: string | Buffer; mode?: number; label?: string }
  | { type: "delete-file"; path: string; label?: string }
  | { type: "write-json"; path: string; content: string; label: "config" | "lock" | "models" };

export interface DesiredPack {
  /** Normalized source (the key in skillpack.json and the lock file). */
  source: string;
  /** ".agents/skills/<folder>" -> the folder's files (paths relative to the folder). */
  skills: Map<string, TreeFile[]>;
  /** ".opencode/agents/<id>.md" -> content. Only agents bound to generate. */
  agents: Map<string, string | Buffer>;
}

export interface BlockedItem {
  path: string;
  kind: "skill" | "agent";
  action: "write" | "delete";
  reason: "foreign" | "edited" | "other-pack";
  pack: string;
}

export interface PlanOptions {
  /** Overwrite or delete foreign and edited targets (--force). */
  force?: boolean;
  /** Rewrite edited skill folders from the lock (what `install` does, R-VER-6). Agents are never restored this way. */
  restoreEdited?: boolean;
}

export interface ChangePlan {
  ops: ProjectOp[];
  blocked: BlockedItem[];
  /** Hash of every desired skill folder, per pack: what goes into the lock file. */
  skillHashes: Record<string, Record<string, string>>;
}

const text = (c: string | Buffer): Buffer => (typeof c === "string" ? Buffer.from(c) : c);

/**
 * Decides what to write and delete for the desired state of each pack (R-SKL-4, R-AGT-7, R-SAF-3).
 * A pack with nothing desired is removed: its locked skills and its generated agent files go.
 * Foreign, edited and other-pack targets are never touched without `force`; they are reported in
 * `blocked`. Config, lock, models and exclude changes are added by the caller.
 */
export function planChanges(
  input: { projectDir: string; lock: Lock | null; desired: DesiredPack[] },
  opts: PlanOptions = {},
): ChangePlan {
  const { projectDir, lock } = input;
  const ops: ProjectOp[] = [];
  const blocked: BlockedItem[] = [];
  const skillHashes: Record<string, Record<string, string>> = {};

  for (const pack of input.desired) {
    const source = pack.source;
    const block = (path: string, kind: BlockedItem["kind"], action: BlockedItem["action"], reason: BlockedItem["reason"]): void => {
      blocked.push({ path, kind, action, reason, pack: source });
    };
    skillHashes[source] = {};

    for (const [path, files] of [...pack.skills].sort(([a], [b]) => (a < b ? -1 : 1))) {
      skillHashes[source]![path] = hashFiles(files);
      const { state, owner } = classifySkillFolder(projectDir, path, lock);
      const same = state !== "absent" && diffFiles(files, safeTree(projectDir, path)).length === 0;
      const write = (): void => void ops.push({ type: "write-skill-folder", path, files });
      if (state === "absent") write();
      else if (owner !== null && owner !== source) {
        if (opts.force) write();
        else block(path, "skill", "write", "other-pack");
      } else if (state === "owned-clean") {
        if (!same) write();
      } else if (state === "owned-edited") {
        if (same) continue;
        if (opts.force || opts.restoreEdited) write();
        else block(path, "skill", "write", "edited");
      } else if (!same) {
        if (opts.force) write();
        else block(path, "skill", "write", "foreign");
      }
    }

    for (const path of Object.keys(lock?.packs[source]?.skills ?? {}).sort()) {
      if (pack.skills.has(path)) continue;
      const { state } = classifySkillFolder(projectDir, path, lock);
      if (state === "owned-clean" || (state === "owned-edited" && opts.force)) ops.push({ type: "delete-skill-folder", path });
      else if (state === "owned-edited") block(path, "skill", "delete", "edited");
    }

    for (const [path, content] of [...pack.agents].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const state = classifyAgentFile(projectDir, path, source);
      const write = (): void => void ops.push({ type: "write-file", path, content, label: "agent" });
      if (state === "absent") write();
      else if (state === "owned-clean") {
        if (!readFileSync(resolve(projectDir, path)).equals(text(content))) write();
      } else if (opts.force) write();
      else block(path, "agent", "write", state === "foreign" ? "foreign" : "edited");
    }

    for (const path of findOwnedAgentFiles(projectDir, source)) {
      if (pack.agents.has(path)) continue;
      const state = classifyAgentFile(projectDir, path, source);
      if (state === "owned-clean" || opts.force) ops.push({ type: "delete-file", path, label: "agent" });
      else block(path, "agent", "delete", "edited");
    }
  }

  ops.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ops, blocked, skillHashes };
}

function safeTree(projectDir: string, path: string): TreeFile[] {
  const abs = resolve(projectDir, path);
  try {
    return readTree(abs);
  } catch {
    return [];
  }
}

export interface ChangeDescription {
  action: "create" | "change" | "delete";
  path: string;
  kind: "skill" | "agent" | "config" | "lock" | "models" | "exclude" | "file";
}

const kindOf = (op: ProjectOp): ChangeDescription["kind"] => {
  if (op.type === "write-skill-folder" || op.type === "delete-skill-folder") return "skill";
  if (op.type === "write-json") return op.label;
  return (op.label as ChangeDescription["kind"] | undefined) ?? "file";
};

/** Project-relative display path for absolute paths inside the project (e.g. the worktree-shared exclude file). */
function displayPath(projectDir: string, path: string): string {
  if (!isAbsolute(path)) return path;
  try {
    const rel = relative(realpathSync(projectDir), path);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split("\\").join("/") : path;
  } catch {
    return path;
  }
}

/** What `--dry-run` prints (R-SAF-1): create, change or delete per path. No-op operations are left out. */
export function describeChanges(projectDir: string, ops: ProjectOp[]): ChangeDescription[] {
  const out: ChangeDescription[] = [];
  for (const op of ops) {
    const abs = resolve(projectDir, op.path);
    const exists = existsSync(abs);
    const kind = kindOf(op);
    if (op.type === "delete-skill-folder" || op.type === "delete-file") {
      if (exists) out.push({ action: "delete", path: displayPath(projectDir, op.path), kind });
    } else if (op.type === "write-skill-folder") {
      if (!exists) out.push({ action: "create", path: displayPath(projectDir, op.path), kind });
      else if (diffFiles(op.files, safeTree(projectDir, op.path)).length > 0) out.push({ action: "change", path: displayPath(projectDir, op.path), kind });
    } else if (!exists) out.push({ action: "create", path: displayPath(projectDir, op.path), kind });
    else if (!readFileSync(abs).equals(text(op.content))) out.push({ action: "change", path: displayPath(projectDir, op.path), kind });
  }
  return out;
}

export function formatChangeDescriptions(list: ChangeDescription[]): string {
  const sign = { create: "+", change: "~", delete: "-" } as const;
  return list.map((d) => `  ${sign[d.action]} ${d.path}${d.kind === "file" ? "" : `  (${d.kind})`}\n`).join("");
}

/** Applies all operations or none (R-SAF-2). `hooks.beforeCommit` is a test seam. */
export function applyChanges(projectDir: string, ops: ProjectOp[], hooks: TransactionHooks = {}): void {
  const changes = ops.map((op): FsChange => {
    const abs = resolve(projectDir, op.path);
    switch (op.type) {
      case "write-skill-folder":
        return { kind: "replace-dir", dir: abs, files: op.files };
      case "delete-skill-folder":
        return { kind: "remove-dir", dir: abs };
      case "write-file":
        return op.mode === undefined ? { kind: "write-file", path: abs, content: op.content } : { kind: "write-file", path: abs, content: op.content, mode: op.mode };
      case "write-json":
        return { kind: "write-file", path: abs, content: op.content };
      case "delete-file":
        return { kind: "remove-file", path: abs };
    }
  });
  applyFsChanges(changes, hooks);
}
