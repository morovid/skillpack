import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { HARNESSES, type Harness } from "./harness.js";

export interface DetectEnv {
  /** Directories on PATH. */
  pathDirs: string[];
  projectDir: string;
  home: string;
  xdgConfigHome?: string;
  exists(path: string): boolean;
}

const BINARIES: Record<Harness, string> = { opencode: "opencode", codex: "codex" };
const SUFFIXES = ["", ".exe", ".cmd", ".bat"];

/** R-CLI-4: a binary on PATH, a project folder, or the harness's user config folder. */
export function detectHarnesses(env: DetectEnv): Harness[] {
  const userDirs: Record<Harness, string[]> = {
    opencode: [join(env.xdgConfigHome ?? join(env.home, ".config"), "opencode"), join(env.home, ".config", "opencode")],
    codex: [join(env.home, ".codex")],
  };
  return HARNESSES.filter((h) => {
    const bin = BINARIES[h];
    if (env.pathDirs.some((d) => SUFFIXES.some((x) => env.exists(join(d, bin + x))))) return true;
    if (env.exists(join(env.projectDir, `.${h}`))) return true;
    return userDirs[h].some((d) => env.exists(d));
  });
}

export function systemDetectEnv(projectDir: string, env: NodeJS.ProcessEnv = process.env): DetectEnv {
  const d: DetectEnv = {
    pathDirs: (env.PATH ?? "").split(delimiter).filter(Boolean),
    projectDir,
    home: env.HOME ?? env.USERPROFILE ?? homedir(),
    exists: existsSync,
  };
  if (env.XDG_CONFIG_HOME) d.xdgConfigHome = env.XDG_CONFIG_HOME;
  return d;
}
