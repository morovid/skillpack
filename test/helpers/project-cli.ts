import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Prompts } from "../../src/core/prompts/index.js";
import { main } from "../../src/main.js";
import { copyValid, createRemotes, write, type TestRemotes } from "./remotes.js";

export type H = "opencode" | "codex";
export const KEY = "https://github.com/acme/skills";
export const OTHER = "https://github.com/acme/other";

const skillMd = (name: string, desc: string) => `---\nname: ${name}\ndescription: ${desc}\nmetadata:\n  internal: "true"\n---\n\n# ${name}\n`;

/** acme/skills (the valid fixture, v1.0.0 and v1.1.0) and acme/other (one skill named review, no agents). */
export function createPackRemotes(): TestRemotes {
  const remotes = createRemotes();
  remotes.add("acme/skills", [
    { apply: copyValid, tag: "v1.0.0" },
    { apply: (w) => write(w, "src/skills/plan_code/SKILL.md", readFileSync(join(w, "src/skills/plan_code/SKILL.md"), "utf8") + "\nv1.1 change\n"), tag: "v1.1.0" },
  ]);
  remotes.add("acme/other", [
    { apply: (w) => { write(w, "skillpack.pack.json", JSON.stringify({ name: "other" })); write(w, "src/skills/review/SKILL.md", skillMd("review", "Other review.")); }, tag: "v1.0.0" },
  ]);
  return remotes;
}

export function makeCli(remotes: TestRemotes) {
  return async (project: string, args: string[], o: { detected?: H[]; env?: Record<string, string>; prompts?: Prompts; interactive?: boolean } = {}) => {
    let out = "";
    let err = "";
    const code = await main(args, {
      cwd: project,
      env: { ...remotes.env, ...(o.env ?? {}) },
      detectHarnesses: () => o.detected ?? ["opencode", "codex"],
      stdout: (t) => (out += t),
      stderr: (t) => (err += t),
      color: false,
      interactive: o.interactive ?? o.prompts !== undefined,
      ...(o.prompts ? { prompts: o.prompts } : {}),
    });
    return { code, out, err };
  };
}

export const readJson = (project: string, f: string) => JSON.parse(readFileSync(join(project, f), "utf8"));
export const git = (remotes: TestRemotes, cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: remotes.env, stdio: "pipe" }).toString();

/** path -> mtime:size of every file except .git, to prove nothing was written. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p.slice(dir.length)] = `${statSync(p).mtimeMs}:${readFileSync(p).length}`;
    }
  };
  walk(dir);
  return out;
}
