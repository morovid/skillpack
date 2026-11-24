import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../frontmatter.js";
import { lockOwner, type Lock } from "../project/lock.js";
import { INSTALLED_SKILLS_DIR } from "../project/paths.js";
import { normalizeSourceKey } from "../source/parse.js";

/**
 * R-SAF-6: skills of this pack that `npx skills` already installed (so they'd load twice): entries
 * in `skills-lock.json` from the same source, or unlisted `.agents/skills` folders whose description
 * equals one of the pack's skill descriptions. Returns the folder names; never removes anything.
 */
export function findNpxSkillsDuplicates(o: {
  projectDir: string;
  key: string;
  lock: Lock | null;
  skills: { name: string; description: string }[];
}): string[] {
  const found = new Set<string>();
  const lockFile = join(o.projectDir, "skills-lock.json");
  if (existsSync(lockFile)) {
    try {
      const doc = JSON.parse(readFileSync(lockFile, "utf8")) as { skills?: Record<string, { source?: unknown }> };
      for (const [name, entry] of Object.entries(doc.skills ?? {})) {
        if (typeof entry?.source !== "string") continue;
        try {
          if (normalizeSourceKey(entry.source) === o.key) found.add(name);
        } catch {
          // not a source we understand
        }
      }
    } catch {
      // unreadable lock file: ignore
    }
  }
  const dir = join(o.projectDir, INSTALLED_SKILLS_DIR);
  if (existsSync(dir)) {
    const descriptions = new Map(o.skills.map((s) => [s.description.trim(), s.name]));
    for (const folder of readdirSync(dir).sort()) {
      if (lockOwner(o.lock, `${INSTALLED_SKILLS_DIR}/${folder}`) !== null) continue;
      const file = join(dir, folder, "SKILL.md");
      if (!existsSync(file)) continue;
      const fm = parseFrontmatter(readFileSync(file, "utf8"));
      if (fm.kind === "ok" && typeof fm.data.description === "string" && descriptions.has(fm.data.description.trim())) {
        found.add(folder);
      }
    }
  }
  return [...found].sort();
}
