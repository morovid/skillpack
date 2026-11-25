import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initProject, type TestRemotes } from "./helpers/remotes.js";
import { KEY, OTHER, createPackRemotes, git, makeCli, readJson, snapshot } from "./helpers/project-cli.js";

let remotes: TestRemotes;
let cli: ReturnType<typeof makeCli>;
beforeAll(() => {
  remotes = createPackRemotes();
  cli = makeCli(remotes);
});

const ADD = ["add", "acme/skills@^1.1.0", "-a", "opencode,codex", "-y"];
const exclude = (p: string) => readFileSync(join(p, ".git/info/exclude"), "utf8");
const read = (p: string, f: string) => readFileSync(join(p, f), "utf8");
const append = (p: string, f: string, t: string) => writeFileSync(join(p, f), read(p, f) + t);
function editConfig(project: string, fn: (pack: any, cfg: any) => void) {
  const cfg = readJson(project, "skillpack.json");
  fn(cfg.packs[KEY], cfg);
  writeFileSync(join(project, "skillpack.json"), JSON.stringify(cfg, null, 2) + "\n");
}
const lockEntry = (p: string) => readJson(p, "skillpack-lock.json").packs[KEY];

describe("sync", () => {
  it("is a no-op right after add: nothing written, lock byte-identical", async () => {
    const project = initProject();
    await cli(project, ADD);
    const lock = read(project, "skillpack-lock.json");
    const before = snapshot(project);
    await new Promise((r) => setTimeout(r, 20));
    const r = await cli(project, ["sync"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("✔ tpack v1.1.0 (synced)");
    expect(r.out).toContain("✔ already in sync; nothing written");
    expect(snapshot(project)).toEqual(before);
    expect(read(project, "skillpack-lock.json")).toBe(lock);
  });

  it("applies a changed binding: agent file and exclude entry go, skills and other agents re-render, lock hashes change, ref/commit don't", async () => {
    const project = initProject();
    await cli(project, ADD);
    const was = lockEntry(project);
    editConfig(project, (p) => (p.agents.scout.opencode = "existing:explore"));
    const r = await cli(project, ["sync"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(existsSync(join(project, ".opencode/agents/tpack-scout.md"))).toBe(false);
    expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(true);
    expect(exclude(project)).not.toContain("/.opencode/agents/tpack-scout.md");
    expect(exclude(project)).toContain("/.codex/agents/tpack-scout.toml");
    expect(read(project, ".opencode/agents/tpack-author.md")).toContain('{ action: subagent, resource: "explore", effect: allow }');
    expect(read(project, ".agents/skills/tpack-review/SKILL.md")).toContain("`explore` (Codex: `tpack-scout`)");
    const now = lockEntry(project);
    expect(now.ref).toBe(was.ref);
    expect(now.commit).toBe(was.commit);
    expect(now.skills[".agents/skills/tpack-review"]).not.toBe(was.skills[".agents/skills/tpack-review"]);
    expect(now.skills[".agents/skills/tpack-plan-code"]).toBe(was.skills[".agents/skills/tpack-plan-code"]);
    expect(r.out).toMatch(/updated\s+\.agents\/skills\/tpack-review/);
    expect(r.out).toMatch(/removed\s+\.opencode\/agents\/tpack-scout\.md/);
    expect(r.out).toContain("Commit: skillpack-lock.json, .agents/skills/tpack-review");
    expect((await cli(project, ["install", "--frozen-lockfile"])).code).toBe(0);
  });

  it("a binding switched to none renders the fallback text and removes the agent files", async () => {
    const project = initProject();
    await cli(project, ADD);
    editConfig(project, (p) => (p.agents.scout = { opencode: "none", codex: "none" }));
    expect((await cli(project, ["sync"])).code).toBe(0);
    expect(read(project, ".agents/skills/tpack-review/SKILL.md")).toContain("Use a helper subagent then");
    expect(existsSync(join(project, ".opencode/agents/tpack-scout.md"))).toBe(false);
    expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(false);
    expect(exclude(project)).not.toContain("tpack-scout");
  });

  it("applies a changed skills list in both directions", async () => {
    const project = initProject();
    await cli(project, ADD);
    editConfig(project, (p) => (p.skills = ["review"]));
    expect((await cli(project, ["sync"])).code).toBe(0);
    expect(readdirSync(join(project, ".agents/skills"))).toEqual(["tpack-review"]);
    expect(Object.keys(lockEntry(project).skills)).toEqual([".agents/skills/tpack-review"]);
    editConfig(project, (p) => (p.skills = "*"));
    const r = await cli(project, ["sync"]);
    expect(r.out).toMatch(/restored\s+\.agents\/skills\/tpack-plan-code|added\s+\.agents\/skills\/tpack-plan-code/);
    expect(readdirSync(join(project, ".agents/skills")).sort()).toEqual(["tpack-plan-code", "tpack-review"]);
    expect((await cli(project, ["install", "--frozen-lockfile"])).code).toBe(0);
  });

  it("applies a changed scope: old folders and agents go, new ones are written", async () => {
    const project = initProject();
    await cli(project, ADD);
    editConfig(project, (p) => (p.scope = "newscope"));
    const r = await cli(project, ["sync"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(readdirSync(join(project, ".agents/skills")).sort()).toEqual(["newscope-plan-code", "newscope-review"]);
    expect(readdirSync(join(project, ".opencode/agents")).sort()).toEqual(["newscope-author.md", "newscope-code-lead.md", "newscope-scout.md"]);
    expect(Object.keys(lockEntry(project).skills)).toEqual([".agents/skills/newscope-plan-code", ".agents/skills/newscope-review"]);
    expect(exclude(project)).toContain("/.opencode/agents/newscope-scout.md");
    expect(exclude(project)).not.toContain("tpack-");
    expect((await cli(project, ["install", "--frozen-lockfile"])).code).toBe(0);
  });

  it("a scope that another pack already uses is a conflict: nothing written", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y", "--as", "taken"]);
    editConfig(project, (p) => (p.scope = "taken"));
    const before = snapshot(project);
    const r = await cli(project, ["sync"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('scope "taken"');
    expect(snapshot(project)).toEqual(before);
  });

  it("an edited skill folder fails the sync without writing; --force overwrites it", async () => {
    const project = initProject();
    await cli(project, ADD);
    append(project, ".agents/skills/tpack-review/SKILL.md", "\nlocal edit\n");
    editConfig(project, (p) => (p.agents.scout.opencode = "none"));
    const before = snapshot(project);
    const r = await cli(project, ["sync"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(".agents/skills/tpack-review (edited since install)");
    expect(r.err).toContain("Nothing was written. Re-run with --force");
    expect(snapshot(project)).toEqual(before);
    const f = await cli(project, ["sync", "--force"]);
    expect(f.code).toBe(0);
    expect(read(project, ".agents/skills/tpack-review/SKILL.md")).not.toContain("local edit");
  });

  it("an edited agent file is kept with a warning while everything else proceeds; --force rewrites it", async () => {
    const project = initProject();
    await cli(project, ADD);
    append(project, ".opencode/agents/tpack-author.md", "\n# hand edit\n");
    editConfig(project, (p) => (p.agents.scout.opencode = "none")); // changes author's subagent rules and the skills
    const r = await cli(project, ["sync"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/kept\s+\.opencode\/agents\/tpack-author\.md \(edited since install; not overwritten\); use --force/);
    expect(read(project, ".opencode/agents/tpack-author.md")).toContain("hand edit");
    expect(existsSync(join(project, ".opencode/agents/tpack-scout.md"))).toBe(false);
    expect(read(project, ".agents/skills/tpack-review/SKILL.md")).toContain("Use `tpack-scout`".replace("`tpack-scout`", "a helper subagent")); // skills re-rendered
    expect(exclude(project)).toContain("/.opencode/agents/tpack-author.md"); // still exists, still excluded
    const f = await cli(project, ["sync", "--force"]);
    expect(f.code).toBe(0);
    expect(read(project, ".opencode/agents/tpack-author.md")).not.toContain("hand edit");
  });

  it("refuses to change versions: a version that no longer satisfies the lock, or a pack missing from it", async () => {
    const project = initProject();
    await cli(project, ADD);
    editConfig(project, (p) => (p.version = "^2.0.0"));
    const before = snapshot(project);
    const r = await cli(project, ["sync"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`${KEY}: locked v1.1.0 doesn't satisfy "^2.0.0"; run skillpack install (or update) to change versions`);
    expect(snapshot(project)).toEqual(before);

    const other = initProject();
    await cli(other, ADD);
    const cfg = readJson(other, "skillpack.json");
    cfg.packs[OTHER] = { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} };
    writeFileSync(join(other, "skillpack.json"), JSON.stringify(cfg));
    const m = await cli(other, ["sync"]);
    expect(m.code).toBe(1);
    expect(m.err).toContain(`${OTHER}: not in the lock file; run skillpack install (or update) to change versions`);
    expect(existsSync(join(other, ".agents/skills/other-review"))).toBe(false);
  });

  it("notes packs that are only in the lock file but doesn't remove them", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    const cfg = readJson(project, "skillpack.json");
    delete cfg.packs[OTHER];
    writeFileSync(join(project, "skillpack.json"), JSON.stringify(cfg));
    const r = await cli(project, ["sync"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`note: ${OTHER} is in the lock file but not in skillpack.json; run skillpack install to clean it up`);
    expect(existsSync(join(project, ".agents/skills/other-review"))).toBe(true);
    expect(readJson(project, "skillpack-lock.json").packs[OTHER]).toBeDefined();
  });

  it("syncing one pack (by scope or source) leaves the other alone", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    append(project, ".agents/skills/other-review/SKILL.md", "\nlocal edit in the other pack\n");
    editConfig(project, (p) => (p.agents.scout.opencode = "none"));
    for (const ref of ["tpack", "acme/skills"]) {
      const r = await cli(project, ["sync", ref]);
      expect(r.code, ref).toBe(0);
    }
    expect(read(project, ".agents/skills/other-review/SKILL.md")).toContain("local edit in the other pack");
    expect(Object.keys(readJson(project, "skillpack-lock.json").packs).sort()).toEqual([KEY, OTHER].sort());
    const bad = await cli(project, ["sync", "nope"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("Configured packs:");
    const all = await cli(project, ["sync"]);
    expect(all.code).toBe(1); // now the edited other pack blocks a full sync
    expect(all.err).toContain("other-review (edited since install)");
  });

  it("skips undetected harnesses and leaves their files alone; -a restricts and overrides detection", async () => {
    const project = initProject();
    await cli(project, ADD);
    editConfig(project, (p) => (p.agents.scout = { opencode: "none", codex: "none" }));
    const r = await cli(project, ["sync"], { detected: ["opencode"] });
    expect(r.code).toBe(0);
    expect(r.out).toContain("codex not detected; left its agents alone");
    expect(existsSync(join(project, ".opencode/agents/tpack-scout.md"))).toBe(false);
    expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(true);
    expect(exclude(project)).toContain("/.codex/agents/tpack-scout.toml");

    const only = await cli(project, ["sync", "-a", "codex"], { detected: [] });
    expect(only.code).toBe(0);
    expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(false);
    expect((await cli(project, ["sync", "-a", "vim"])).code).toBe(2);

    const p2 = initProject();
    await cli(p2, ADD);
    editConfig(p2, (p) => (p.agents.scout = { opencode: "none", codex: "none" }));
    await cli(p2, ["sync", "-a", "codex"]);
    expect(existsSync(join(p2, ".codex/agents/tpack-scout.toml"))).toBe(false);
    expect(existsSync(join(p2, ".opencode/agents/tpack-scout.md"))).toBe(true); // not touched: -a codex only
  });

  it("applies a skillpack.json changed by someone else after git pull", async () => {
    const a = initProject();
    await cli(a, ADD);
    git(remotes, a, "add", "-A");
    git(remotes, a, "commit", "-q", "-m", "add pack");
    const b = join(realpathSync(mkdtempSync(join(tmpdir(), "sp-clone-"))), "b");
    git(remotes, a, "clone", "-q", a, b);
    expect((await cli(b, ["install"])).code).toBe(0);
    expect(existsSync(join(b, ".opencode/agents/tpack-scout.md"))).toBe(true);

    editConfig(a, (p) => (p.agents.scout.opencode = "existing:explore"));
    expect((await cli(a, ["sync"])).code).toBe(0);
    git(remotes, a, "add", "-A");
    git(remotes, a, "commit", "-q", "-m", "scout uses explore");

    git(remotes, b, "pull", "-q");
    expect((await cli(b, ["install", "--frozen-lockfile"])).code).toBe(0); // skills came with the pull
    const r = await cli(b, ["sync"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(b, ".opencode/agents/tpack-scout.md"))).toBe(false);
    expect(read(b, ".opencode/agents/tpack-author.md")).toContain('resource: "explore"');
    expect(git(remotes, b, "status", "--porcelain")).toBe("");
  });

  it("--dry-run writes nothing; the user's own files and exclude lines survive; the exclude block ends up exact", async () => {
    const project = initProject();
    writeFileSync(join(project, ".git/info/exclude"), "node_modules\n");
    await cli(project, ADD);
    mkdirSync(join(project, ".opencode/agents"), { recursive: true });
    writeFileSync(join(project, ".opencode/agents/mine.md"), "my own agent\n");
    writeFileSync(join(project, "skillpack.models.json"), JSON.stringify({ packs: {} }));
    writeFileSync(join(project, ".git/info/exclude"), exclude(project).replace("# <<< skillpack", "/.opencode/agents/tpack-stale.md\n# <<< skillpack") + "my-last-line\n");
    editConfig(project, (p) => (p.agents.scout.opencode = "none"));

    const before = snapshot(project);
    const ex = exclude(project);
    const dry = await cli(project, ["sync", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("Would change");
    expect(dry.out).toContain("- .opencode/agents/tpack-scout.md  (agent)");
    expect(snapshot(project)).toEqual(before);
    expect(exclude(project)).toBe(ex);

    expect((await cli(project, ["sync"])).code).toBe(0);
    const text = exclude(project);
    expect(text.startsWith("node_modules\n")).toBe(true);
    expect(text.endsWith("my-last-line\n")).toBe(true);
    expect(text).not.toContain("tpack-stale");
    expect(text).not.toContain("tpack-scout.md");
    expect(text).toContain("/skillpack.models.json");
    expect(text).toContain("/.opencode/agents/tpack-author.md");
    expect(read(project, ".opencode/agents/mine.md")).toBe("my own agent\n");
    expect(execFileSync("git", ["check-ignore", ".opencode/agents/tpack-author.md"], { cwd: project, env: remotes.env }).toString()).toContain("tpack-author.md");
  });

  it("errors without skillpack.json, and --json reports the result", async () => {
    expect((await cli(initProject(), ["sync"])).err).toContain("no skillpack.json; add a pack with skillpack add");
    const project = initProject();
    await cli(project, ADD);
    editConfig(project, (p) => (p.agents.scout.opencode = "none"));
    const j = JSON.parse((await cli(project, ["sync", "--json", "--dry-run"])).out);
    expect(j).toMatchObject({ ok: true, dryRun: true });
    expect(j.packs[0]).toMatchObject({ source: KEY, ref: "refs/tags/v1.1.0" });
    expect(j.skills.map((s: { path: string }) => s.path)).toEqual([".agents/skills/tpack-review"]);
  });
});
