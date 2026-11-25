import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const exclude = (project: string) => readFileSync(join(project, ".git/info/exclude"), "utf8");
const put = (project: string, path: string, content: string) => {
  mkdirSync(join(project, path, ".."), { recursive: true });
  writeFileSync(join(project, path), content);
};
const append = (project: string, path: string, text: string) => writeFileSync(join(project, path), readFileSync(join(project, path), "utf8") + text);

describe("remove a pack", () => {
  it("deletes its skills, agents, config, lock, models and exclude entries, and nothing else", async () => {
    const project = initProject();
    writeFileSync(join(project, ".git/info/exclude"), "node_modules\n");
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    put(project, ".opencode/agents/mine.md", "my own agent\n");
    put(project, ".codex/agents/mine.toml", "name = 'mine'\n");
    put(project, ".agents/skills/foreign/SKILL.md", "foreign\n");
    writeFileSync(join(project, "skillpack.models.json"), JSON.stringify({ packs: { [KEY]: { "sonnet-5.5": { opencode: "gh/claude-sonnet-5.5" } }, [OTHER]: { x: { codex: "x" } } } }));
    expect(exclude(project)).toContain("/.opencode/agents/tpack-author.md");

    const r = await cli(project, ["remove", "tpack"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain(`- pack ${KEY}`);
    expect(r.out).toContain("Commit: skillpack.json, skillpack-lock.json, .agents/skills/tpack-plan-code, .agents/skills/tpack-review");

    expect(readdirSync(join(project, ".agents/skills")).sort()).toEqual(["foreign", "other-review"]);
    expect(readdirSync(join(project, ".opencode/agents"))).toEqual(["mine.md"]);
    expect(readdirSync(join(project, ".codex/agents"))).toEqual(["mine.toml"]);
    expect(Object.keys(readJson(project, "skillpack.json").packs)).toEqual([OTHER]);
    expect(Object.keys(readJson(project, "skillpack-lock.json").packs)).toEqual([OTHER]);
    expect(Object.keys(readJson(project, "skillpack.models.json").packs)).toEqual([OTHER]);
    expect(exclude(project)).toBe("node_modules\n"); // block gone, user line kept
  });

  it("keeps the exclude block entries of other packs and the user's lines around it", async () => {
    const project = initProject();
    writeFileSync(join(project, ".git/info/exclude"), "before\n");
    await cli(project, ADD);
    append(project, ".git/info/exclude", "after\n");
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y", "--agent", "none"]);
    await cli(project, ["remove", "acme/other"]);
    const text = exclude(project);
    expect(text).toContain("before\n");
    expect(text).toContain("after\n");
    expect(text).toContain("/.opencode/agents/tpack-author.md");
    await cli(project, ["remove", "tpack"]);
    expect(exclude(project)).toBe("before\nafter\n");
  });

  it("an edited skill fails without --force (nothing written) and is removed with it", async () => {
    const project = initProject();
    await cli(project, ADD);
    append(project, ".agents/skills/tpack-review/SKILL.md", "\nlocal edit\n");
    const before = snapshot(project);
    const r = await cli(project, ["remove", "tpack"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(".agents/skills/tpack-review (edited since install)");
    expect(r.err).toContain("Nothing was removed. Re-run with --force");
    expect(snapshot(project)).toEqual(before);
    expect(existsSync(join(project, ".opencode/agents/tpack-author.md"))).toBe(true);
    const f = await cli(project, ["remove", "tpack", "--force"]);
    expect(f.code).toBe(0);
    expect(existsSync(join(project, ".agents/skills/tpack-review"))).toBe(false);
    expect(readJson(project, "skillpack.json").packs).toEqual({});
  });

  it("an edited agent file fails without --force and is removed with it", async () => {
    const project = initProject();
    await cli(project, ADD);
    append(project, ".codex/agents/tpack-scout.toml", "# hand edit\n");
    const before = snapshot(project);
    const r = await cli(project, ["remove", "tpack"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(".codex/agents/tpack-scout.toml (edited since install)");
    expect(snapshot(project)).toEqual(before);
    expect((await cli(project, ["remove", "tpack", "--force"])).code).toBe(0);
    expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(false);
  });

  it("a foreign file in an agent folder is never deleted, even with --force", async () => {
    const project = initProject();
    await cli(project, ADD);
    writeFileSync(join(project, ".opencode/agents/tpack-scout.md"), "my own agent with the same name\n");
    const r = await cli(project, ["remove", "tpack", "--force"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(project, ".opencode/agents/tpack-scout.md"), "utf8")).toBe("my own agent with the same name\n");
    expect(existsSync(join(project, ".opencode/agents/tpack-author.md"))).toBe(false);
  });

  it("removing the last pack leaves valid, empty files", async () => {
    const project = initProject();
    await cli(project, ADD);
    expect((await cli(project, ["remove", "acme/skills"])).code).toBe(0);
    expect(readJson(project, "skillpack.json")).toEqual({ $schema: "https://skillpack.morovid.com/schemas/v1/config.json", packs: {} });
    expect(readJson(project, "skillpack-lock.json")).toMatchObject({ packs: {} });
    expect((await cli(project, ["install", "--frozen-lockfile"])).code).toBe(0);
    expect((await cli(project, ["list"])).out).toContain("no packs configured");
  });

  it("--dry-run writes nothing", async () => {
    const project = initProject();
    await cli(project, ADD);
    const before = snapshot(project);
    const ex = exclude(project);
    const r = await cli(project, ["remove", "tpack", "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Would change");
    expect(r.out).toContain("- .agents/skills/tpack-review  (skill)");
    expect(r.out).toContain("- .opencode/agents/tpack-author.md  (agent)");
    expect(r.out).toContain("~ skillpack.json  (config)");
    expect(r.out).toContain("~ .git/info/exclude  (exclude)");
    expect(snapshot(project)).toEqual(before);
    expect(exclude(project)).toBe(ex);
  });
});

describe("remove a skill", () => {
  it('from a "*" pack: fetches the locked commit and rewrites skills to the remaining source names', async () => {
    const project = initProject();
    await cli(project, ADD);
    const r = await cli(project, ["remove", "review"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("fetched https://github.com/acme/skills at the locked commit");
    expect(readJson(project, "skillpack.json").packs[KEY].skills).toEqual(["plan_code"]);
    expect(existsSync(join(project, ".agents/skills/tpack-review"))).toBe(false);
    expect(Object.keys(readJson(project, "skillpack-lock.json").packs[KEY].skills)).toEqual([".agents/skills/tpack-plan-code"]);
    expect(r.out).toContain("Commit: skillpack.json, skillpack-lock.json, .agents/skills/tpack-review");
    expect((await cli(project, ["install", "--frozen-lockfile"])).code).toBe(0);
  });

  it("by qualified and folder names, including _ skills", async () => {
    const project = initProject();
    await cli(project, ADD);
    expect((await cli(project, ["remove", "tpack/plan_code"])).code).toBe(0);
    expect(readJson(project, "skillpack.json").packs[KEY].skills).toEqual(["review"]);
    const other = initProject();
    await cli(other, ADD);
    expect((await cli(other, ["remove", "tpack-plan-code"])).code).toBe(0);
    expect(readJson(other, "skillpack.json").packs[KEY].skills).toEqual(["review"]);
  });

  it("from a list pack works offline; an edited folder is kept without --force", async () => {
    const project = initProject();
    await cli(project, [...ADD, "-s", "plan_code,review"]);
    append(project, ".agents/skills/tpack-review/SKILL.md", "\nlocal\n");
    const before = snapshot(project);
    const blocked = await cli(project, ["remove", "review"]);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("tpack-review (edited since install)");
    expect(snapshot(project)).toEqual(before);
    const r = await cli(project, ["remove", "review", "--force"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("fetched");
    expect(readJson(project, "skillpack.json").packs[KEY].skills).toEqual(["plan_code"]);
  });

  it("removing the last skill is an error that points at removing the pack", async () => {
    const project = initProject();
    await cli(project, [...ADD, "-s", "review"]);
    const before = snapshot(project);
    const r = await cli(project, ["remove", "review"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("without skills; remove the pack instead");
    expect(snapshot(project)).toEqual(before);
  });
});

describe("remove an agent", () => {
  it("binds it to none, deletes its files, re-renders skills with the fallback text, updates the lock and exclude", async () => {
    const project = initProject();
    await cli(project, ADD);
    const skill = join(project, ".agents/skills/tpack-review/SKILL.md");
    expect(readFileSync(skill, "utf8")).toContain("`tpack-scout`");
    const oldHash = readJson(project, "skillpack-lock.json").packs[KEY].skills[".agents/skills/tpack-review"];

    const r = await cli(project, ["remove", "scout"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("fetched");
    expect(readJson(project, "skillpack.json").packs[KEY].agents.scout).toEqual({ opencode: "none", codex: "none" });
    expect(existsSync(join(project, ".opencode/agents/tpack-scout.md"))).toBe(false);
    expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(false);
    expect(existsSync(join(project, ".opencode/agents/tpack-author.md"))).toBe(true);
    expect(readFileSync(skill, "utf8")).toContain("Use a helper subagent then");
    expect(readJson(project, "skillpack-lock.json").packs[KEY].skills[".agents/skills/tpack-review"]).not.toBe(oldHash);
    expect(exclude(project)).not.toContain("tpack-scout");
    expect(exclude(project)).toContain("tpack-author");
    expect(r.out).toContain("Commit: skillpack.json, skillpack-lock.json, .agents/skills/tpack-review");
    expect((await cli(project, ["install", "--frozen-lockfile"])).code).toBe(0);
  });

  it("-a limits it to one harness; the skill phrase becomes harness-qualified", async () => {
    const project = initProject();
    await cli(project, ADD);
    const r = await cli(project, ["remove", "agent:scout", "-a", "codex"]);
    expect(r.code).toBe(0);
    expect(readJson(project, "skillpack.json").packs[KEY].agents.scout).toEqual({ opencode: "generate", codex: "none" });
    expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(false);
    expect(existsSync(join(project, ".opencode/agents/tpack-scout.md"))).toBe(true);
    expect(readFileSync(join(project, ".agents/skills/tpack-review/SKILL.md"), "utf8")).toContain("`tpack-scout` (Codex: a helper subagent)");
    expect((await cli(project, ["remove", "scout", "-a", "vim"])).code).toBe(2);
  });

  it("keeps edited skills and agent files without --force", async () => {
    const project = initProject();
    await cli(project, ADD);
    append(project, ".agents/skills/tpack-review/SKILL.md", "\nlocal\n");
    const before = snapshot(project);
    const r = await cli(project, ["remove", "scout"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("tpack-review (edited since install)");
    expect(snapshot(project)).toEqual(before);
    expect((await cli(project, ["remove", "scout", "--force"])).code).toBe(0);
  });

  it("--dry-run writes nothing", async () => {
    const project = initProject();
    await cli(project, ADD);
    const before = snapshot(project);
    const r = await cli(project, ["remove", "scout", "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("- .opencode/agents/tpack-scout.md  (agent)");
    expect(r.out).toContain("~ .agents/skills/tpack-review  (skill)");
    expect(snapshot(project)).toEqual(before);
  });
});

describe("remove: resolving what you typed", () => {
  it("a bare name in two packs needs the pack; the qualified name works", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    const before = snapshot(project);
    const r = await cli(project, ["remove", "review"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('matches more than one pack');
    expect(r.err).toContain("tpack/review or other/review");
    expect(snapshot(project)).toEqual(before);
    expect((await cli(project, ["remove", "other-review"])).err).toContain("without skills"); // exact folder name, but it's the last skill
    const q = await cli(project, ["remove", "tpack/review"]);
    expect(q.code).toBe(0);
    expect(existsSync(join(project, ".agents/skills/other-review"))).toBe(true);
    expect(existsSync(join(project, ".agents/skills/tpack-review"))).toBe(false);
  });

  it("a name that is both a skill and an agent needs skill:/agent:", async () => {
    const project = initProject();
    await cli(project, ADD);
    const cfg = readJson(project, "skillpack.json");
    cfg.packs[KEY].agents.review = { opencode: "none", codex: "none" };
    writeFileSync(join(project, "skillpack.json"), JSON.stringify(cfg));
    const r = await cli(project, ["remove", "review"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("both a skill and an agent");
    expect((await cli(project, ["remove", "skill:review"])).code).toBe(0);
  });

  it("unknown refs and usage errors", async () => {
    const project = initProject();
    await cli(project, ADD);
    const r = await cli(project, ["remove", "nope"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('nothing named "nope"');
    expect((await cli(project, ["remove"])).code).toBe(2);
    expect((await cli(initProject(), ["remove", "x"])).code).toBe(1);
  });

  it("a pack that is only in the lock file points at install, and nothing is written", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    const cfg = readJson(project, "skillpack.json");
    delete cfg.packs[OTHER];
    writeFileSync(join(project, "skillpack.json"), JSON.stringify(cfg));
    const before = Object.fromEntries(["skillpack.json", "skillpack-lock.json", ".git/info/exclude"].map((f) => [f, readFileSync(join(project, f), "utf8")]));
    const files = snapshot(project);
    const tail = "is in skillpack-lock.json but not in skillpack.json; run `skillpack install` to clean it up";
    for (const ref of ["acme/other", OTHER, "other"]) {
      const r = await cli(project, ["remove", ref]);
      expect(r.code, ref).toBe(1);
      expect(r.err, ref).toContain(`${OTHER} ${tail}`);
      expect(r.err).not.toContain("nothing named");
    }
    const unrelated = await cli(project, ["remove", "nope"]);
    expect(unrelated.code).toBe(1);
    expect(unrelated.err).toContain('nothing named "nope"');
    expect(snapshot(project)).toEqual(files);
    for (const [f, text] of Object.entries(before)) expect(readFileSync(join(project, f), "utf8")).toBe(text);
  });

  it("several lock-only packs matching one ref are listed", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y", "--as", "tpack2"]);
    const lock = readJson(project, "skillpack-lock.json");
    lock.packs["https://github.com/acme/third"] = { ref: null, commit: "a".repeat(40), skills: { ".agents/skills/tpack2-extra": "sha256-" + "b".repeat(64) } };
    writeFileSync(join(project, "skillpack-lock.json"), JSON.stringify(lock));
    writeFileSync(join(project, "skillpack.json"), JSON.stringify({ packs: {} }));
    const r = await cli(project, ["remove", "tpack2"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('"tpack2" matches several packs that are in skillpack-lock.json but not in skillpack.json: ');
    expect(r.err).toContain(OTHER);
    expect(r.err).toContain("https://github.com/acme/third");
  });

  it("removes several things in one transaction, and a pack subsumes its skills", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    const r = await cli(project, ["remove", "tpack", "tpack/review", "acme/other"]);
    expect(r.code).toBe(0);
    expect(readdirSync(join(project, ".agents/skills"))).toEqual([]);
    expect(readJson(project, "skillpack.json").packs).toEqual({});
    expect(git(remotes, project, "status", "--porcelain")).toContain("skillpack.json");
  });
});
