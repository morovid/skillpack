import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_INSTRUCTIONS_FILE, AGENT_MANIFEST_FILE, AGENT_SOURCES_DIR } from "../paths.js";
import { readJsonFile, type JsonResult } from "./json.js";

export interface AgentDefinition {
  /** Folder name = agent source name. */
  name: string;
  dir: string;
  manifest: JsonResult;
  /** instructions.md content, or null when missing. */
  instructions: string | null;
}

export const agentRel = (name: string, file = ""): string =>
  [AGENT_SOURCES_DIR.split("\\").join("/"), name, file].filter(Boolean).join("/");

export function loadAgentDefinitions(packDir: string): AgentDefinition[] {
  const root = join(packDir, AGENT_SOURCES_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const dir = join(root, name);
      const instr = join(dir, AGENT_INSTRUCTIONS_FILE);
      return {
        name,
        dir,
        manifest: readJsonFile(join(dir, AGENT_MANIFEST_FILE)),
        instructions: existsSync(instr) ? readFileSync(instr, "utf8") : null,
      };
    });
}
