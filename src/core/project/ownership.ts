import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAgentHeader, verifyAgentHash } from "../agents/header.js";
import { hashFolder } from "../hash.js";
import { HARNESSES, type Harness } from "../harness.js";
import { lockOwner, type Lock } from "./lock.js";
import { AGENT_DIRS, AGENT_EXT } from "./paths.js";

export type SkillOwnership = "absent" | "owned-clean" | "owned-edited" | "foreign";
export type AgentOwnership = "absent" | "owned-clean" | "owned-edited" | "foreign";

export interface SkillClassification {
  state: SkillOwnership;
  /** Pack whose lock entry lists the folder. */
  owner: string | null;
}

/**
 * R-SKL-4: a skill folder belongs to skillpack only if the lock file lists it. "edited" means the
 * folder's hash (CRLF-normalized for text files) differs from the locked one.
 */
export function classifySkillFolder(projectDir: string, skillPath: string, lock: Lock | null): SkillClassification {
  const abs = join(projectDir, skillPath);
  const owner = lockOwner(lock, skillPath);
  let isDir = false;
  try {
    isDir = lstatSync(abs).isDirectory();
  } catch {
    return { state: "absent", owner };
  }
  if (owner === null) return { state: "foreign", owner };
  if (!isDir) return { state: "owned-edited", owner };
  const clean = hashFolder(abs) === lock!.packs[owner]!.skills[skillPath];
  return { state: clean ? "owned-clean" : "owned-edited", owner };
}

/** R-AGT-7: owned when the header names this pack source; clean when the hash still verifies. */
export function classifyAgentFile(projectDir: string, agentPath: string, packSource: string): AgentOwnership {
  const abs = join(projectDir, agentPath);
  if (!existsSync(abs)) return "absent";
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return "foreign";
  }
  const header = parseAgentHeader(text);
  if (header === null || header.source !== packSource) return "foreign";
  return verifyAgentHash(text) ? "owned-clean" : "owned-edited";
}

/** Generated agent files (by header) that name this pack source, as project-relative paths. */
export function findOwnedAgentFiles(projectDir: string, packSource: string, harnesses: readonly Harness[] = HARNESSES): string[] {
  const out: string[] = [];
  for (const h of harnesses) {
    const dir = join(projectDir, AGENT_DIRS[h]);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(AGENT_EXT[h])) continue;
      const rel = `${AGENT_DIRS[h]}/${name}`;
      try {
        if (parseAgentHeader(readFileSync(join(dir, name), "utf8"))?.source === packSource) out.push(rel);
      } catch {
        // unreadable: not ours
      }
    }
  }
  return out;
}

/** Pack sources named by the headers of generated agent files (used to find agents of packs that are gone). */
export function listAgentSources(projectDir: string, harnesses: readonly Harness[] = HARNESSES): string[] {
  const out = new Set<string>();
  for (const h of harnesses) {
    const dir = join(projectDir, AGENT_DIRS[h]);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(AGENT_EXT[h])) continue;
      try {
        const src = parseAgentHeader(readFileSync(join(dir, name), "utf8"))?.source;
        if (src) out.add(src);
      } catch {
        // unreadable: not ours
      }
    }
  }
  return [...out].sort();
}
