import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initProject, write, type TestRemotes } from "./helpers/remotes.js";
import { git, makeCli, readJson, snapshot } from "./helpers/project-cli.js";
import { fakeModels } from "./helpers/models.js";
import { scriptedPrompts } from "./helpers/prompts.js";
import { createRemotes } from "./helpers/remotes.js";

let remotes: TestRemotes;
let cli: ReturnType<typeof makeCli>;
const EVO = "https://github.com/acme/evolve";
const BRANCHY = "https://github.com/acme/branchy";

const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: Skill ${name}.\nmetadata:\n  internal: "true"\n---\n\n${body}\n`;
const agent = (w: string, name: string, extra: Record<string, unknown> = {}) => {
  write(w, `src/agents/${name}/manifest.json`, JSON.stringify({ description: `Agent ${name}.`, fallback: `a ${name}`, ...extra }));
  write(w, `src/agents/${name}/instructions.md`, `You are ${name}.\n`);
};
/** Replaces the whole pack tree. */
function tree(w: string, name: string, skills: Record<string, string>, agents: Record<string, Record<string, unknown>>) {
  rmSync(join(w, "src"), { recursive: true, force: true });
  write(w, "skillpack.pack.json", JSON.stringify({ name }));
  for (const [n, body] of Object.entries(skills)) write(w, `src/skills/${n}/SKILL.md`, skill(n, body));
  for (const [n, extra] of Object.entries(agents)) agent(w, n, extra);
}

beforeAll(() => {
  remotes = createRemotes();
  remotes.add("acme/evolve", [
    { apply: (w) => tree(w, "evo", { one: "v1.0 uses {{agent:scout}}.", two: "two", extra: "extra" }, { scout: {}, oldie: {} }), tag: "v1.0.0" },
    { apply: (w) => tree(w, "evo", { one: "v1.1 uses {{agent:scout}} and {{agent:helper}}.", two: "two", extra: "extra" }, { scout: {}, oldie: {}, helper: { model: { name: "sonnet-5.5", effort: "low" } } }), tag: "v1.1.0" },
    { apply: (w) => tree(w, "evo2", { one: "v2 uses {{agent:scout}}.", two: "two" }, { scout: {}, helper: {} }), tag: "v2.0.0" },
    { apply: (w) => tree(w, "evo2", { one: "v2.1 beta {{agent:scout}}.", two: "two" }, { scout: {}, helper: {} }), tag: "v2.1.0-beta.1" },
  ]);
  remotes.add("acme/branchy", [{ apply: (w) => tree(w, "br", { one: "first" }, {}) }]);
  remotes.add("acme/other", [{ apply: (w) => tree(w, "other", { solo: "solo" }, {}), tag: "v1.0.0" }]);
  remotes.alias("acme/gone", join(remotes.root, "does-not-exist.git"));
  cli = makeCli(remotes);
});

const read = (p: string, f: string) => readFileSync(join(p, f), "utf8");
const exclude = (p: string) => read(p, ".git/info/exclude");
const cfgPack = (p: string, key = EVO) => readJson(p, "skillpack.json").packs[key];
const lockPack = (p: string, key = EVO) => readJson(p, "skillpack-lock.json").packs[key];
const setVersion = (p: string, version: string, key = EVO) => {
  const cfg = readJson(p, "skillpack.json");
  cfg.packs[key].version = version;
  writeFileSync(join(p, "skillpack.json"), JSON.stringify(cfg));
};
const models = () => fakeModels({ opencode: ["github-copilot/claude-sonnet-5.5"] });

/** evolve installed at exactly v1.0.0, with `requested` saved as its version. */
async function atV1(requested = "^1.0.0", extra: string[] = []) {
  const p = initProject();
  const r = await cli(p, ["add", "acme/evolve@1.0.0", "-a", "opencode", "-y", ...extra], { models: models() });
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  setVersion(p, requested);
  return p;
}
const noopChecks = async (p: string) => {
  expect((await cli(p, ["install", "--frozen-lockfile"], { models: models() })).code).toBe(0);
  const s = await cli(p, ["sync"], { models: models() });
  expect(s.code).toBe(0);
  expect(s.out).toContain("already in sync; nothing written");
};

describe("check", () => {
  it("shows update and upgrade candidates; prereleases only with the flag", async () => {
    const p = await atV1();
    const before = snapshot(p);
    const r = await cli(p, ["check"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/pack\s+requested\s+locked\s+update\s+upgrade/);
    expect(r.out).toMatch(/evo\s+\^1\.0\.0\s+v1\.0\.0\s+v1\.1\.0\s+v2\.0\.0/);
    expect(r.out).toContain("Run skillpack update");
    expect(r.out).toContain("Run skillpack upgrade");
    expect(snapshot(p)).toEqual(before);
    expect((await cli(p, ["check", "--include-prerelease"])).out).toMatch(/v1\.1\.0\s+v2\.1\.0-beta\.1/);
  });

  it("everything up to date; exact pin has only an upgrade; --exit-code", async () => {
    const p = initProject();
    await cli(p, ["add", "acme/evolve", "-a", "opencode", "-y"], { models: models() });
    const r = await cli(p, ["check"]);
    expect(r.out).toContain("✔ everything is up to date");
    expect((await cli(p, ["check", "--exit-code"])).code).toBe(0);

    const q = await atV1("1.0.0");
    const pin = await cli(q, ["check"]);
    expect(pin.out).toMatch(/evo\s+1\.0\.0\s+v1\.0\.0\s+-\s+v2\.0\.0/);
    expect(pin.code).toBe(0);
    expect((await cli(q, ["check", "--exit-code"])).code).toBe(1);
  });

  it("a branch pack: shows the moved tip, no upgrade; a commit pin: nothing", async () => {
    const p = initProject();
    await cli(p, ["add", "acme/branchy@main", "-a", "opencode", "-y"]);
    const commit = lockPack(p, BRANCHY).commit as string;
    expect((await cli(p, ["check"])).out).toContain("✔ everything is up to date");
    remotes.push("acme/branchy", { apply: (w) => tree(w, "br", { one: "second" }, {}) });
    const r = await cli(p, ["check"]);
    expect(r.out).toMatch(new RegExp(`main moved: ${commit.slice(0, 7)} → [0-9a-f]{7}`));
    expect(r.out).toContain("follows a branch");
    const pin = initProject();
    await cli(pin, ["add", `acme/branchy@${commit.slice(0, 10)}`, "-a", "opencode", "-y"]);
    const c = await cli(pin, ["check"]);
    expect(c.out).toMatch(/pinned to commit|follows a branch or is pinned/);
    expect(c.out).not.toMatch(/moved/);
  });

  it("--json, packs not installed, filters, and an unreachable remote", async () => {
    const p = await atV1();
    const j = JSON.parse((await cli(p, ["check", "--json"])).out);
    expect(j.outdated).toBe(true);
    expect(j.packs[0]).toMatchObject({ source: EVO, scope: "evo", requested: "^1.0.0", locked: "v1.0.0", update: { to: "v1.1.0", ref: "refs/tags/v1.1.0" }, upgrade: { to: "v2.0.0" }, error: null });

    const cfg = readJson(p, "skillpack.json");
    cfg.packs["https://github.com/acme/other"] = { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} };
    writeFileSync(join(p, "skillpack.json"), JSON.stringify(cfg));
    const r = await cli(p, ["check"]);
    expect(r.out).toContain("not installed (run skillpack install)");
    expect(r.code).toBe(0);
    expect((await cli(p, ["check", "evo"])).out).not.toContain("other");
    expect((await cli(p, ["check", "nope"])).code).toBe(1);

    cfg.packs["https://github.com/acme/gone"] = { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} };
    writeFileSync(join(p, "skillpack.json"), JSON.stringify(cfg));
    const lock = readJson(p, "skillpack-lock.json");
    lock.packs["https://github.com/acme/gone"] = { ref: "refs/tags/v1.0.0", commit: "a".repeat(40), skills: {} };
    writeFileSync(join(p, "skillpack-lock.json"), JSON.stringify(lock));
    const bad = await cli(p, ["check"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("couldn't reach the remote");
    expect(bad.out).toMatch(/evo\s+\^1\.0\.0\s+v1\.0\.0\s+v1\.1\.0/); // the other rows still print
  });
});

describe("update", () => {
  it("moves within the range, keeps version, binds a new agent explicitly, and leaves frozen install and sync no-ops", async () => {
    const p = await atV1();
    expect(read(p, ".agents/skills/evo-one/SKILL.md")).toContain("v1.0 uses");
    const r = await cli(p, ["update"], { models: models() });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("↑ evo v1.0.0 → v1.1.0");
    expect(r.out).toContain("new agent: helper");
    expect(read(p, ".agents/skills/evo-one/SKILL.md")).toContain("v1.1 uses");
    expect(lockPack(p).ref).toBe("refs/tags/v1.1.0");
    expect(cfgPack(p).version).toBe("^1.0.0"); // not touched, although v2.0.0 exists
    expect(cfgPack(p).agents).toEqual({ scout: { opencode: "generate" }, oldie: { opencode: "generate" }, helper: { opencode: "generate" } });
    expect(existsSync(join(p, ".opencode/agents/evo-helper.md"))).toBe(true);
    expect(read(p, ".opencode/agents/evo-helper.md")).toContain("model: github-copilot/claude-sonnet-5.5#low"); // models for the new agent's model name
    expect(exclude(p)).toContain("/.opencode/agents/evo-helper.md");
    expect(r.out).toMatch(/Commit: skillpack\.json, skillpack-lock\.json, \.agents\/skills\/evo-one/);
    await noopChecks(p);
    expect((await cli(p, ["update"], { models: models() })).out).toMatch(/= evo v1\.1\.0 \(up to date\)/);
  });

  it("asks only about new agents when interactive", async () => {
    const p = await atV1();
    const { prompts, asked } = scriptedPrompts(["none"]);
    const r = await cli(p, ["update"], { models: models(), prompts });
    expect(r.code).toBe(0);
    expect(asked.map((a) => a.message)).toEqual(["helper in OpenCode"]);
    expect(cfgPack(p).agents.helper).toEqual({ opencode: "none" });
    expect(existsSync(join(p, ".opencode/agents/evo-helper.md"))).toBe(false);
    expect(read(p, ".agents/skills/evo-one/SKILL.md")).toContain("and a helper"); // fallback text
  });

  it("pins stay: an exact version and a commit; a branch re-resolves", async () => {
    const pin = await atV1("1.0.0");
    const before = snapshot(pin);
    const r = await cli(pin, ["update"], { models: models() });
    expect(r.code).toBe(0);
    expect(r.out).toContain("pinned to 1.0.0; nothing to update");
    expect(snapshot(pin)).toEqual(before);

    const b = initProject();
    await cli(b, ["add", "acme/branchy@main", "-a", "opencode", "-y"]);
    const was = lockPack(b, BRANCHY).commit;
    remotes.push("acme/branchy", { apply: (w) => tree(w, "br", { one: "third" }, {}) });
    const u = await cli(b, ["update"]);
    expect(u.code).toBe(0);
    expect(lockPack(b, BRANCHY).commit).not.toBe(was);
    expect(lockPack(b, BRANCHY).ref).toBe("refs/heads/main");
    expect(read(b, ".agents/skills/br-one/SKILL.md")).toContain("third");
    expect(u.out).toMatch(/↑ br main@[0-9a-f]{7} → main@[0-9a-f]{7}/);
    expect((await cli(b, ["install", "--frozen-lockfile"])).code).toBe(0);
  });

  it("an edited skill blocks (nothing written); --force overwrites; --dry-run writes nothing", async () => {
    const p = await atV1();
    writeFileSync(join(p, ".agents/skills/evo-one/SKILL.md"), read(p, ".agents/skills/evo-one/SKILL.md") + "\nlocal\n");
    const before = snapshot(p);
    const r = await cli(p, ["update"], { models: models() });
    expect(r.code).toBe(1);
    expect(r.err).toContain(".agents/skills/evo-one (edited since install)");
    expect(r.err).toContain("Nothing was written");
    expect(snapshot(p)).toEqual(before);

    const dry = await cli(p, ["update", "--dry-run", "--force"], { models: models() });
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("Would change");
    expect(dry.out).toContain("~ skillpack.json  (config)");
    expect(snapshot(p)).toEqual(before);

    expect((await cli(p, ["update", "--force"], { models: models() })).code).toBe(0);
    expect(read(p, ".agents/skills/evo-one/SKILL.md")).toContain("v1.1 uses");
  });

  it("packs not in the lock fail; filters pick packs; others are untouched", async () => {
    const p = await atV1();
    await cli(p, ["add", "acme/other", "-a", "opencode", "-y"]);
    const cfg = readJson(p, "skillpack.json");
    cfg.packs["https://github.com/acme/notlocked"] = { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} };
    writeFileSync(join(p, "skillpack.json"), JSON.stringify(cfg));
    const bad = await cli(p, ["update", "evo", "notlocked"]);
    expect(bad.code).toBe(1);
    const r = await cli(p, ["update", "evo"], { models: models() });
    expect(r.code).toBe(0);
    expect(lockPack(p).ref).toBe("refs/tags/v1.1.0");
    expect(lockPack(p, "https://github.com/acme/other").ref).toBe("refs/tags/v1.0.0");
  });
});

describe("upgrade", () => {
  it("moves to the newest version, rewrites ^1.0.0 to ^2.0.0, drops removed agents, and follows a name change", async () => {
    const p = await atV1();
    expect(existsSync(join(p, ".opencode/agents/evo-oldie.md"))).toBe(true);
    expect(exclude(p)).toContain("evo-oldie");
    const r = await cli(p, ["upgrade"], { models: models() });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("↑ evo2 v1.0.0 → v2.0.0");
    expect(r.out).toContain("version in skillpack.json: ^1.0.0 → ^2.0.0");
    expect(r.out).toContain("the pack's name changed: scope evo → evo2");
    expect(r.out).toContain("removed agent: oldie (binding dropped)");
    expect(cfgPack(p).version).toBe("^2.0.0");
    expect(Object.keys(cfgPack(p).agents).sort()).toEqual(["helper", "scout"]);
    expect(readdirSync(join(p, ".agents/skills")).sort()).toEqual(["evo2-one", "evo2-two"]); // old evo-* gone, `extra` gone with the pack
    expect(readdirSync(join(p, ".opencode/agents")).sort()).toEqual(["evo2-helper.md", "evo2-scout.md"]);
    expect(Object.keys(lockPack(p).skills)).toEqual([".agents/skills/evo2-one", ".agents/skills/evo2-two"]);
    expect(lockPack(p).ref).toBe("refs/tags/v2.0.0");
    const ex = exclude(p);
    expect(ex).not.toContain("evo-oldie");
    expect(ex).not.toContain("/.opencode/agents/evo-scout.md");
    expect(ex).toContain("/.opencode/agents/evo2-scout.md");
    await noopChecks(p);
    expect((await cli(p, ["upgrade"], { models: models() })).out).toMatch(/= evo2 v2\.0\.0 \(already the latest version\)/);
  });

  it("keeps the form of the version: ~1.0.0 → ~2.0.0, exact 1.0.0 → 2.0.0; update leaves them alone", async () => {
    const tilde = await atV1("~1.0.0");
    expect((await cli(tilde, ["upgrade"], { models: models() })).code).toBe(0);
    expect(cfgPack(tilde).version).toBe("~2.0.0");
    const exact = await atV1("1.0.0");
    expect((await cli(exact, ["upgrade"], { models: models() })).code).toBe(0);
    expect(cfgPack(exact).version).toBe("2.0.0");
    expect(lockPack(exact).ref).toBe("refs/tags/v2.0.0");
    await noopChecks(exact);
  });

  it("prereleases only with --include-prerelease", async () => {
    const p = await atV1();
    await cli(p, ["upgrade", "--include-prerelease"], { models: models() });
    expect(lockPack(p).ref).toBe("refs/tags/v2.1.0-beta.1");
    expect(cfgPack(p).version).toBe("^2.1.0-beta.1");
    await noopChecks(p);
  });

  it("branch and commit pins are left alone with a note, and nothing is written", async () => {
    const b = initProject();
    await cli(b, ["add", "acme/branchy@main", "-a", "opencode", "-y"]);
    const before = snapshot(b);
    const r = await cli(b, ["upgrade"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/"main" follows a branch or is pinned to a commit or non-semver tag; upgrade leaves it alone/);
    expect(snapshot(b)).toEqual(before);
    const commit = lockPack(b, BRANCHY).commit;
    const c = initProject();
    await cli(c, ["add", `acme/branchy@${commit.slice(0, 10)}`, "-a", "opencode", "-y"]);
    expect((await cli(c, ["upgrade"])).out).toContain("upgrade leaves it alone");
  });

  it("a scope override (--as) means the folders don't move when the name changes", async () => {
    const p = await atV1("^1.0.0", ["--as", "mine"]);
    expect(readdirSync(join(p, ".agents/skills")).sort()).toEqual(["mine-extra", "mine-one", "mine-two"]);
    const r = await cli(p, ["upgrade"], { models: models() });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("the pack's name changed");
    expect(readdirSync(join(p, ".agents/skills")).sort()).toEqual(["mine-one", "mine-two"]);
    expect(cfgPack(p).scope).toBe("mine");
    await noopChecks(p);
  });

  it("edited skills under the old scope block the move", async () => {
    const p = await atV1();
    writeFileSync(join(p, ".agents/skills/evo-two/SKILL.md"), read(p, ".agents/skills/evo-two/SKILL.md") + "\nlocal\n");
    const before = snapshot(p);
    const r = await cli(p, ["upgrade"], { models: models() });
    expect(r.code).toBe(1);
    expect(r.err).toContain(".agents/skills/evo-two (edited since install)");
    expect(snapshot(p)).toEqual(before);
  });

  it("a listed skill the new version no longer has is an error", async () => {
    const p = await atV1("^1.0.0", ["-s", "one,extra"]);
    const before = snapshot(p);
    const r = await cli(p, ["upgrade"], { models: models() });
    expect(r.code).toBe(1);
    expect(r.err).toContain("no longer has the skills extra listed in skillpack.json");
    expect(snapshot(p)).toEqual(before);
  });

  it("works on several packs in one transaction and by filter", async () => {
    const p = await atV1();
    await cli(p, ["add", "acme/other", "-a", "opencode", "-y"]);
    const only = await cli(p, ["upgrade", "acme/evolve"], { models: models() });
    expect(only.code).toBe(0);
    expect(lockPack(p, "https://github.com/acme/other").ref).toBe("refs/tags/v1.0.0");
    expect(only.out).not.toContain("other");
    const all = await cli(p, ["upgrade"], { models: models() });
    expect(all.code).toBe(0);
    expect(all.out).toMatch(/= other v1\.0\.0 \(already the latest version\)/);
    expect(git(remotes, p, "status", "--porcelain")).toContain("skillpack.json");
  });
});
