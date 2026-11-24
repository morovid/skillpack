import type { Harness } from "../harness.js";

/** Fixed project file locations (R-CLI-6). All relative to the project root, with `/`. */
export const CONFIG_FILE = "skillpack.json";
export const LOCK_FILE = "skillpack-lock.json";
export const MODELS_FILE = "skillpack.models.json";
export const INSTALLED_SKILLS_DIR = ".agents/skills";
export const AGENT_DIRS: Record<Harness, string> = {
  opencode: ".opencode/agents",
  codex: ".codex/agents",
};
export const AGENT_EXT: Record<Harness, string> = { opencode: ".md", codex: ".toml" };

export const skillFolderPath = (folder: string): string => `${INSTALLED_SKILLS_DIR}/${folder}`;
export const agentFilePath = (harness: Harness, id: string): string => `${AGENT_DIRS[harness]}/${id}${AGENT_EXT[harness]}`;

export const SCHEMA_BASE = "https://skillpack.morovid.com/schemas/v1";
