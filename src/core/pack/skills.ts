import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_FILE, SKILL_SOURCES_DIR } from "../paths.js";

export interface SkillSource {
  /** Folder name = skill source name. */
  name: string;
  dir: string;
  /** Path to SKILL.md, or null when the folder has none. */
  skillFile: string | null;
  /** SKILL.md content, or null when missing. */
  skillText: string | null;
}

export const skillRel = (name: string, file = ""): string =>
  [SKILL_SOURCES_DIR.split("\\").join("/"), name, file].filter(Boolean).join("/");

export function listSkillSources(packDir: string): SkillSource[] {
  const root = join(packDir, SKILL_SOURCES_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const dir = join(root, name);
      const skillFile = join(dir, SKILL_FILE);
      const has = existsSync(skillFile);
      return {
        name,
        dir,
        skillFile: has ? skillFile : null,
        skillText: has ? readFileSync(skillFile, "utf8") : null,
      };
    });
}
