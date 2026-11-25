import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { copyValid, createRemotes, initProject, write, type TestRemotes } from "./helpers/remotes.js";

let remotes: TestRemotes;
const KEY = "https://github.com/acme/skills";
type H = "opencode" | "codex";

beforeAll(() => {
  remotes = createRemotes();
  remotes.add("acme/skills", [
    { apply: copyValid, tag: "v1.0.0" },
    { apply: (w) => write(w, "src/skills/plan_code/SKILL.md", readFileSync(join(w, "src/skills/plan_code/SKILL.md"), "utf8") + "\nv1.1 change\n"), tag: "v1.1.0" },
    { apply: (w) => write(w, "src/skills/plan_code/SKILL.md", readFileSync(join(w, "src/skills/plan_code/SKILL.md"), "utf8") + "\nv2 change\n"), tag: "v2.0.0" },
  ]);
  remotes.add("acme/other", [
    { apply: (w) => {
      write(w, "skillpack.pack.json", JSON.stringify({ name: "other" }));
      write(w, "src/skills/review/SKILL.md", "---\nname: review\ndescription: Other review.\nmetadata:\n  internal: \"true\"\n---\n\n# review\n");
    }, tag: "v1.0.0" },
  ]);
});

async function cli(project: string, args: string[], o: { detected?: H[]; env?: Record<string, string> } = {}) {
  let out = "";
  let err = "";
  const code = await main(args, {
    cwd: project,
    env: { ...remotes.env, ...(o.env ?? {}) },
    detectHarnesses: () => o.detected ?? ["opencode", "codex"],
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
    color: false,
  });
  return { code, out, err };
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: remotes.env, stdio: "pipe" }).toString();
const readJson = (project: string, f: string) => JSON.parse(readFileSync(join(project, f), "utf8"));
const writeJson = (project: string, f: string, v: unknown) => writeFileSync(join(project, f), JSON.stringify(v, null, 2) + "\n");

function snapshot(dir: string): Record<string, string> {
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

/** A project as it looks after `add` and a commit, then a fresh clone: no generated agents, empty exclude. */
async function clonedProject(args = ["add", "acme/skills@^1.1.0", "-a", "opencode,codex", "-y"]): Promise<string> {
  const project = initProject();
  const r = await cli(project, args);
  expect(r.err).toBe("");
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "init");
  for (const d of [".opencode", ".codex"]) await import("node:fs").then((fs) => fs.rmSync(join(project, d), { recursive: true, force: true }));
  writeFileSync(join(project, ".git/info/exclude"), "");
  return project;
}

describe("install", () => {
  it("fresh clone: generates agents for detected harnesses, adds the exclude block, writes nothing tracked", async () => {
    const project = await clonedProject();
    expect(git(project, "status", "--porcelain")).toContain("");
    const lockBefore = readFileSync(join(project, "skillpack-lock.json"), "utf8");
    const r = await cli(project, ["install"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("✔ tpack v1.1.0 (locked)");
    expect(existsSync(join(project, ".opencode/agents/tpack-author.md"))).toBe(true);
    expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(true);
    expect(readFileSync(join(project, ".opencode/agents/tpack-author.md"), "utf8")).not.toMatch(/^model:/m);
    expect(r.out).toContain("model matching isn't available yet");
    const exclude = readFileSync(join(project, ".git/info/exclude"), "utf8");
    expect(exclude).toContain("/.opencode/agents/tpack-author.md");
    expect(exclude).toContain("/.codex/agents/tpack-scout.toml");
    expect(readFileSync(join(project, "skillpack-lock.json"), "utf8")).toBe(lockBefore);
    expect(git(project, "status", "--porcelain")).toBe("");
    expect(existsSync(join(project, "skillpack.models.json"))).toBe(false);
  });

  it("is idempotent and writes nothing the second time", async () => {
    const project = await clonedProject();
    await cli(project, ["install"]);
    const before = snapshot(project);
    const exclude = readFileSync(join(project, ".git/info/exclude"), "utf8");
    await new Promise((r) => setTimeout(r, 20));
    const r = await cli(project, ["install"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("already up to date");
    expect(snapshot(project)).toEqual(before);
    expect(readFileSync(join(project, ".git/info/exclude"), "utf8")).toBe(exclude);
  });

  it("restores edited and missing skill folders and lists them", async () => {
    const project = await clonedProject();
    const skill = join(project, ".agents/skills/tpack-review/SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nlocal edit\n");
    await import("node:fs").then((fs) => fs.rmSync(join(project, ".agents/skills/tpack-plan-code"), { recursive: true }));
    const r = await cli(project, ["install"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/restored\s+\.agents\/skills\/tpack-review/);
    expect(r.out).toMatch(/restored\s+\.agents\/skills\/tpack-plan-code/);
    expect(r.out).toContain("Commit: skillpack-lock.json and the changed .agents/skills folders");
    expect(readFileSync(skill, "utf8")).not.toContain("local edit");
    expect(git(project, "status", "--porcelain", "--", ".agents")).toBe("");
  });

  it("re-resolves when version no longer satisfies the lock, and updates the lock and skills", async () => {
    const project = await clonedProject();
    const cfg = readJson(project, "skillpack.json");
    cfg.packs[KEY].version = "^2.0.0";
    writeJson(project, "skillpack.json", cfg);
    const r = await cli(project, ["install"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("↻ tpack v2.0.0 (re-resolved from ^2.0.0)");
    expect(readJson(project, "skillpack-lock.json").packs[KEY].version).toBe("v2.0.0");
    expect(readFileSync(join(project, ".agents/skills/tpack-plan-code/SKILL.md"), "utf8")).toContain("v2 change");
    expect(r.out).toMatch(/updated\s+\.agents\/skills\/tpack-plan-code/);
    expect(readJson(project, "skillpack.json").packs[KEY].version).toBe("^2.0.0"); // never rewritten
  });

  it("keeps the locked commit while the range is still satisfied, even with a newer tag", async () => {
    const project = await clonedProject(["add", "acme/skills@1.0.0", "-a", "opencode,codex", "-y"]);
    const cfg = readJson(project, "skillpack.json");
    cfg.packs[KEY].version = "^1.0.0"; // v1.1.0 exists, but the lock holds v1.0.0
    writeJson(project, "skillpack.json", cfg);
    const r = await cli(project, ["install"]);
    expect(r.out).toContain("✔ tpack v1.0.0 (locked)");
    expect(readJson(project, "skillpack-lock.json").packs[KEY].version).toBe("v1.0.0");
    expect(readFileSync(join(project, ".agents/skills/tpack-plan-code/SKILL.md"), "utf8")).not.toContain("v1.1 change");
  });

  it("packs missing from the lock are resolved and locked", async () => {
    const project = await clonedProject();
    const cfg = readJson(project, "skillpack.json");
    cfg.packs["https://github.com/acme/other"] = { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} };
    writeJson(project, "skillpack.json", cfg);
    const r = await cli(project, ["install"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("not in the lock file");
    expect(readJson(project, "skillpack-lock.json").packs["https://github.com/acme/other"].version).toBe("v1.0.0");
    expect(existsSync(join(project, ".agents/skills/other-review/SKILL.md"))).toBe(true);
  });

  it("removes packs that left the config: skills (even edited) and agent files, lock entry; exclude untouched", async () => {
    const project = await clonedProject();
    await cli(project, ["install"]);
    const excludeBefore = readFileSync(join(project, ".git/info/exclude"), "utf8");
    const skill = join(project, ".agents/skills/tpack-review/SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nlocal edit\n");
    const agent = join(project, ".codex/agents/tpack-scout.toml");
    writeFileSync(agent, readFileSync(agent, "utf8") + "\n# hand edit\n");
    writeJson(project, "skillpack.json", { packs: {} });
    const r = await cli(project, ["install"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("- https://github.com/acme/skills removed");
    expect(r.out).toContain(".agents/skills/tpack-review had local edits and was deleted");
    expect(existsSync(join(project, ".agents/skills/tpack-review"))).toBe(false);
    expect(existsSync(join(project, ".agents/skills/tpack-plan-code"))).toBe(false);
    expect(existsSync(join(project, ".opencode/agents/tpack-author.md"))).toBe(false);
    expect(existsSync(agent)).toBe(true); // edited: kept
    expect(r.out).toContain(".codex/agents/tpack-scout.toml (edited since install; not deleted)");
    expect(readJson(project, "skillpack-lock.json").packs).toEqual({});
    expect(readFileSync(join(project, ".git/info/exclude"), "utf8")).toBe(excludeBefore);
    const f = await cli(project, ["install", "--force"]);
    expect(f.code).toBe(0);
    expect(existsSync(agent)).toBe(false);
  });

  it("a foreign folder in the way fails without writing; --force overwrites", async () => {
    const project = initProject();
    writeJson(project, "skillpack.json", { packs: { [KEY]: { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} } } });
    mkdirSync(join(project, ".agents/skills/tpack-review"), { recursive: true });
    writeFileSync(join(project, ".agents/skills/tpack-review/SKILL.md"), "mine\n");
    const before = snapshot(project);
    const r = await cli(project, ["install"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(".agents/skills/tpack-review (not installed by skillpack)");
    expect(r.err).toContain("--force");
    expect(snapshot(project)).toEqual(before);
    expect(existsSync(join(project, "skillpack-lock.json"))).toBe(false);
    const f = await cli(project, ["install", "--force"]);
    expect(f.code).toBe(0);
    expect(readFileSync(join(project, ".agents/skills/tpack-review/SKILL.md"), "utf8")).toContain("name: tpack-review");
    expect(existsSync(join(project, "skillpack-lock.json"))).toBe(true);
  });

  it("skips undetected harnesses with a note", async () => {
    const project = await clonedProject();
    const r = await cli(project, ["install"], { detected: ["opencode"] });
    expect(r.code).toBe(0);
    expect(r.out).toContain("codex not detected; skipped agents for it");
    expect(existsSync(join(project, ".opencode/agents/tpack-author.md"))).toBe(true);
    expect(existsSync(join(project, ".codex"))).toBe(false);
    expect(readFileSync(join(project, ".git/info/exclude"), "utf8")).not.toContain(".codex");
  });

  it("keeps foreign and edited agent files with a warning and still installs the rest", async () => {
    const project = await clonedProject();
    mkdirSync(join(project, ".opencode/agents"), { recursive: true });
    writeFileSync(join(project, ".opencode/agents/tpack-scout.md"), "my own agent\n");
    const r = await cli(project, ["install"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(project, ".opencode/agents/tpack-scout.md"), "utf8")).toBe("my own agent\n");
    expect(r.out).toContain(".opencode/agents/tpack-scout.md (not installed by skillpack; not overwritten); use --force");
    expect(existsSync(join(project, ".opencode/agents/tpack-author.md"))).toBe(true);
    expect((await cli(project, ["install", "--force"])).code).toBe(0);
    expect(readFileSync(join(project, ".opencode/agents/tpack-scout.md"), "utf8")).toContain("generated by skillpack");
  });

  it("--dry-run writes nothing", async () => {
    const project = await clonedProject();
    const before = snapshot(project);
    const exclude = readFileSync(join(project, ".git/info/exclude"), "utf8");
    const r = await cli(project, ["install", "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Would change");
    expect(r.out).toContain("+ .opencode/agents/tpack-author.md  (agent)");
    expect(r.out).toContain("~ .git/info/exclude  (exclude)");
    expect(snapshot(project)).toEqual(before);
    expect(readFileSync(join(project, ".git/info/exclude"), "utf8")).toBe(exclude);
  });

  it("--json prints a structured result", async () => {
    const project = await clonedProject();
    const j = JSON.parse((await cli(project, ["install", "--json", "--dry-run"])).out);
    expect(j).toMatchObject({ ok: true, dryRun: true });
    expect(j.packs[0]).toMatchObject({ source: KEY, status: "locked", version: "v1.1.0" });
    expect(j.packs[0].agentFiles).toContain(".opencode/agents/tpack-author.md");
  });

  it("errors without or with an invalid skillpack.json", async () => {
    const project = initProject();
    const missing = await cli(project, ["install"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no skillpack.json; add a pack with skillpack add");
    writeJson(project, "skillpack.json", { packs: { [KEY]: { version: "^1", harnesses: ["vim"] } } });
    const bad = await cli(project, ["install"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("/packs/");
    expect((await cli(project, ["install", "--frozen-lockfile", "--no-frozen-lockfile"])).code).toBe(2);
    expect((await cli(project, ["install", "extra"])).code).toBe(2);
  });

  it("fails before writing on a scope collision between configured packs", async () => {
    const project = await clonedProject();
    const cfg = readJson(project, "skillpack.json");
    cfg.packs["https://github.com/acme/other"] = { version: "^1.0.0", harnesses: ["opencode"], skills: "*", scope: "tpack", agents: {} };
    writeJson(project, "skillpack.json", cfg);
    const before = snapshot(project);
    const r = await cli(project, ["install"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('scope "tpack"');
    expect(snapshot(project)).toEqual(before);
  });
});

describe("install --frozen-lockfile", () => {
  it("passes on a clean state without writing or generating agents", async () => {
    const project = await clonedProject();
    const before = snapshot(project);
    const r = await cli(project, ["install", "--frozen-lockfile"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✔ lockfile and skills are up to date");
    expect(snapshot(project)).toEqual(before);
    expect(existsSync(join(project, ".opencode"))).toBe(false);
    expect(readFileSync(join(project, ".git/info/exclude"), "utf8")).toBe("");
  });

  it("fails without writing when the lock is outdated", async () => {
    const project = await clonedProject();
    const cfg = readJson(project, "skillpack.json");
    cfg.packs[KEY].version = "^2.0.0";
    writeJson(project, "skillpack.json", cfg);
    const before = snapshot(project);
    const r = await cli(project, ["install", "--frozen-lockfile"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`${KEY}: locked v1.1.0 doesn't satisfy "^2.0.0"`);
    expect(r.err).toContain("Nothing was written");
    expect(snapshot(project)).toEqual(before);
  });

  it("fails when the lock has packs missing from the config, or the reverse", async () => {
    const project = await clonedProject();
    const cfg = readJson(project, "skillpack.json");
    cfg.packs["https://github.com/acme/other"] = { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} };
    writeJson(project, "skillpack.json", cfg);
    expect((await cli(project, ["install", "--frozen-lockfile"])).err).toContain("is in skillpack.json but not in the lock file");
    writeJson(project, "skillpack.json", { packs: {} });
    expect((await cli(project, ["install", "--frozen-lockfile"])).err).toContain("is in the lock file but not in skillpack.json");
  });

  it("fails when a skill folder was edited or removed", async () => {
    const project = await clonedProject();
    const skill = join(project, ".agents/skills/tpack-review/SKILL.md");
    const original = readFileSync(skill, "utf8");
    writeFileSync(skill, original + "\nedit\n");
    const r = await cli(project, ["install", "--frozen-lockfile"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(".agents/skills/tpack-review is missing or was edited");
    expect(readFileSync(skill, "utf8")).toContain("edit"); // untouched
    writeFileSync(skill, original);
    await import("node:fs").then((fs) => fs.rmSync(join(project, ".agents/skills/tpack-plan-code"), { recursive: true }));
    expect((await cli(project, ["install", "--frozen-lockfile"])).err).toContain(".agents/skills/tpack-plan-code is missing or was edited");
  });

  it("fails when the configured skills changed", async () => {
    const project = await clonedProject();
    const cfg = readJson(project, "skillpack.json");
    cfg.packs[KEY].skills = ["review"];
    writeJson(project, "skillpack.json", cfg);
    const r = await cli(project, ["install", "--frozen-lockfile"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(".agents/skills/tpack-plan-code is no longer part of the configured skills");
    cfg.packs[KEY].skills = "*";
    cfg.packs[KEY].agents.scout.opencode = "existing:explore"; // bindings change skill text
    writeJson(project, "skillpack.json", cfg);
    expect((await cli(project, ["install", "--frozen-lockfile"])).err).toContain("differs from what the locked commit renders");
  });

  it("is the default when CI is set; --no-frozen-lockfile overrides", async () => {
    const project = await clonedProject();
    const skill = join(project, ".agents/skills/tpack-review/SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nedit\n");
    const ci = await cli(project, ["install"], { env: { CI: "1" } });
    expect(ci.code).toBe(1);
    expect(ci.err).toContain("out of date");
    expect(existsSync(join(project, ".opencode"))).toBe(false);
    expect((await cli(project, ["install"], { env: { CI: "false" } })).code).toBe(0); // restored
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nedit\n");
    const no = await cli(project, ["install", "--no-frozen-lockfile"], { env: { CI: "true" } });
    expect(no.code).toBe(0);
    expect(no.out).toContain("restored");
  });
});
