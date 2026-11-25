import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initProject, type TestRemotes } from "./helpers/remotes.js";
import { KEY, OTHER, createPackRemotes, makeCli, readJson, snapshot } from "./helpers/project-cli.js";
import { CANCEL, scriptedPrompts } from "./helpers/prompts.js";

let remotes: TestRemotes;
let cli: ReturnType<typeof makeCli>;
beforeAll(() => {
  remotes = createPackRemotes();
  cli = makeCli(remotes);
});

const ADD = ["add", "acme/skills@^1.1.0", "-a", "opencode,codex", "-y"];
const exclude = (p: string) => readFileSync(join(p, ".git/info/exclude"), "utf8");
const read = (p: string, f: string) => readFileSync(join(p, f), "utf8");
const lockEntry = (p: string) => readJson(p, "skillpack-lock.json").packs[KEY];
const agents = (p: string) => readJson(p, "skillpack.json").packs[KEY].agents;

async function installed(args = ADD) {
  const project = initProject();
  expect((await cli(project, args)).code).toBe(0);
  return project;
}

function expectScoutUsesExplore(project: string) {
  expect(agents(project).scout).toEqual({ opencode: "existing:explore", codex: "generate" });
  expect(existsSync(join(project, ".opencode/agents/tpack-scout.md"))).toBe(false);
  expect(existsSync(join(project, ".codex/agents/tpack-scout.toml"))).toBe(true);
  expect(exclude(project)).not.toContain("/.opencode/agents/tpack-scout.md");
  expect(read(project, ".opencode/agents/tpack-author.md")).toContain('resource: "explore"');
  expect(read(project, ".agents/skills/tpack-review/SKILL.md")).toContain("`explore` (Codex: `tpack-scout`)");
}

describe("configure: changing bindings", () => {
  it("interactively: updates skillpack.json and runs the sync pipeline in one go", async () => {
    const project = await installed();
    const was = lockEntry(project);
    const { prompts, asked } = scriptedPrompts(["per-harness", "existing:explore", "generate"]);
    const r = await cli(project, ["configure", "tpack", "scout"], { prompts });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(asked.map((a) => a.message)).toEqual(["scout: Read-only search of the codebase.", "scout in OpenCode", "scout in Codex"]);
    expectScoutUsesExplore(project);
    const now = lockEntry(project);
    expect([now.ref, now.commit]).toEqual([was.ref, was.commit]);
    expect(now.skills[".agents/skills/tpack-review"]).not.toBe(was.skills[".agents/skills/tpack-review"]);
    expect(r.out).toContain("scout (OpenCode): generate → existing:explore");
    expect(r.out).toContain("✔ configured 1 pack");
    expect(r.out).toContain("Commit: skillpack.json, skillpack-lock.json, .agents/skills/tpack-review");
    expect((await cli(project, ["install", "--frozen-lockfile"])).code).toBe(0);
  });

  it("with --bind: the same result without prompts", async () => {
    const project = await installed();
    const r = await cli(project, ["configure", "tpack", "--bind", "scout.opencode=existing:explore"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expectScoutUsesExplore(project);
    expect((await cli(project, ["install", "--frozen-lockfile"])).code).toBe(0);
  });

  it("the pack can be left out when only one is configured; scoped agent names work", async () => {
    const project = await installed();
    expect((await cli(project, ["configure", "--bind", "tpack-scout.codex=none"])).code).toBe(0);
    expect(agents(project).scout).toEqual({ opencode: "generate", codex: "none" });
    const p2 = await installed();
    expect((await cli(p2, ["configure", "scout", "--bind", "scout=none"])).code).toBe(0); // [agent...] without a pack
    expect(agents(p2).scout).toEqual({ opencode: "none", codex: "none" });
  });

  it("-a limits --bind and the prompts to one harness; the agent list limits the prompts", async () => {
    const project = await installed();
    expect((await cli(project, ["configure", "tpack", "--bind", "author=none", "-a", "opencode"])).code).toBe(0);
    expect(agents(project).author).toEqual({ opencode: "none", codex: "generate" });
    expect(existsSync(join(project, ".codex/agents/tpack-author.toml"))).toBe(true);
    expect(existsSync(join(project, ".opencode/agents/tpack-author.md"))).toBe(false);

    const { prompts, asked } = scriptedPrompts(["existing:worker"]);
    const r = await cli(project, ["configure", "tpack", "scout", "-a", "codex"], { prompts });
    expect(r.code).toBe(0);
    expect(asked.map((a) => a.message)).toEqual(["scout in Codex"]);
    expect(agents(project).scout).toEqual({ opencode: "generate", codex: "existing:worker" });
  });

  it("a new agent (in the pack, not in skillpack.json) is written explicitly, defaulting to generate", async () => {
    const project = await installed();
    const cfg = readJson(project, "skillpack.json");
    delete cfg.packs[KEY].agents.code_lead;
    writeFileSync(join(project, "skillpack.json"), JSON.stringify(cfg));
    const r = await cli(project, ["configure", "tpack", "-y"]);
    expect(r.code).toBe(0);
    expect(agents(project).code_lead).toEqual({ opencode: "generate", codex: "generate" });
    expect(r.out).toContain("code_lead (OpenCode): (not set) → generate");

    const cfg2 = readJson(project, "skillpack.json");
    delete cfg2.packs[KEY].agents.code_lead;
    writeFileSync(join(project, "skillpack.json"), JSON.stringify(cfg2));
    const { prompts } = scriptedPrompts(["none"]);
    expect((await cli(project, ["configure", "tpack", "code_lead"], { prompts })).code).toBe(0);
    expect(agents(project).code_lead).toEqual({ opencode: "none", codex: "none" });
    expect(existsSync(join(project, ".opencode/agents/tpack-code-lead.md"))).toBe(false);
  });
});

describe("configure: protection and safety", () => {
  it("an edited skill folder blocks without --force: nothing is written, not even skillpack.json", async () => {
    const project = await installed();
    writeFileSync(join(project, ".agents/skills/tpack-review/SKILL.md"), read(project, ".agents/skills/tpack-review/SKILL.md") + "\nlocal\n");
    const before = snapshot(project);
    const r = await cli(project, ["configure", "tpack", "--bind", "scout=none"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(".agents/skills/tpack-review (edited since install)");
    expect(r.err).toContain("Nothing was written");
    expect(snapshot(project)).toEqual(before);
    expect((await cli(project, ["configure", "tpack", "--bind", "scout=none", "--force"])).code).toBe(0);
    expect(agents(project).scout).toEqual({ opencode: "none", codex: "none" });
  });

  it("--dry-run writes nothing and shows the skillpack.json change", async () => {
    const project = await installed();
    const before = snapshot(project);
    const ex = exclude(project);
    const r = await cli(project, ["configure", "tpack", "--bind", "scout.opencode=existing:explore", "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Would configure");
    expect(r.out).toContain("scout (OpenCode): generate → existing:explore");
    expect(r.out).toContain("~ skillpack.json  (config)");
    expect(r.out).toContain("- .opencode/agents/tpack-scout.md  (agent)");
    expect(snapshot(project)).toEqual(before);
    expect(exclude(project)).toBe(ex);
  });

  it("cancelling a prompt exits 130 and writes nothing", async () => {
    const project = await installed();
    const before = snapshot(project);
    const { prompts } = scriptedPrompts(["per-harness", CANCEL]);
    const r = await cli(project, ["configure", "tpack", "scout"], { prompts });
    expect(r.code).toBe(130);
    expect(r.err).toContain("cancelled");
    expect(snapshot(project)).toEqual(before);
  });

  it("-y changes nothing when every binding is already explicit", async () => {
    const project = await installed();
    const before = snapshot(project);
    const r = await cli(project, ["configure", "tpack", "-y"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("nothing to configure");
    expect(snapshot(project)).toEqual(before);
  });

  it("needs a terminal (or --bind or -y)", async () => {
    const project = await installed();
    const before = snapshot(project);
    const r = await cli(project, ["configure", "tpack"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("interactive terminal required; use --bind");
    expect(snapshot(project)).toEqual(before);
  });

  it("unknown pack, agent and harness are errors", async () => {
    const project = await installed();
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    const pack = await cli(project, ["configure", "nope", "-y"]);
    expect(pack.code).toBe(1);
    expect(pack.err).toContain("Configured packs:");
    const agent = await cli(project, ["configure", "tpack", "ghost", "-y"]);
    expect(agent.code).toBe(2);
    expect(agent.err).toContain('no agent "ghost"');
    expect(agent.err).toContain("author, code_lead, scout");
    expect((await cli(project, ["configure", "tpack", "-a", "vim", "-y"])).code).toBe(2);
    expect((await cli(project, ["configure", "other", "-a", "codex", "-y"])).code).toBe(2); // not installed for codex
    expect((await cli(project, ["configure", "tpack", "--bind", "scout=existing:explore"])).code).toBe(2); // explore isn't a Codex built-in
  });

  it("several packs: asks which one when interactive, lists them otherwise", async () => {
    const project = await installed();
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    const list = await cli(project, ["configure", "--bind", "scout=none"]);
    expect(list.code).toBe(1);
    expect(list.err).toContain("several packs are configured; name one:");
    expect(list.err).toContain(OTHER);
    const { prompts, asked } = scriptedPrompts([KEY, "none", "none", "none"]);
    const r = await cli(project, ["configure"], { prompts });
    expect(r.code).toBe(0);
    expect(asked[0]!.message).toBe("Which pack?");
    expect(asked[0]!.options!.map((o) => o.value)).toEqual([KEY, OTHER]);
    expect(agents(project).scout).toEqual({ opencode: "none", codex: "none" });
  });

  it("a pack that is not in the lock file points at install", async () => {
    const project = initProject();
    writeFileSync(join(project, "skillpack.json"), JSON.stringify({ packs: { [KEY]: { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} } } }));
    const r = await cli(project, ["configure", "tpack", "--bind", "scout=none"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not in the lock file; run skillpack install");
  });
});

describe("configure --show", () => {
  it("prints the bindings, harnesses and the models line, offline and read-only", async () => {
    const project = await installed();
    await cli(project, ["configure", "tpack", "--bind", "scout.opencode=existing:explore"]);
    const before = snapshot(project);
    const r = await cli(project, ["configure", "tpack", "--show"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`tpack  ${KEY}`);
    expect(r.out).toContain("harnesses  OpenCode, Codex");
    expect(r.out).toMatch(/scout\s+existing:explore\s+generate/);
    expect(r.out).toMatch(/author\s+generate\s+generate/);
    expect(r.out).toMatch(/models\n\s+model\s+harness\s+mapped to\s+status/);
    expect(r.out).toMatch(/sonnet-5\.5\s+OpenCode\s+-\s+not mapped/);
    expect(r.out).toMatch(/sonnet-5\.5\s+Codex\s+sonnet-5\.5\s+unverified/);
    expect(snapshot(project)).toEqual(before);
  });

  it("filters by agent, and --json has the full structure", async () => {
    const project = await installed();
    const r = await cli(project, ["configure", "--show", "--json", "scout"]);
    const j = JSON.parse(r.out);
    expect(j.packs[0]).toMatchObject({ source: KEY, scope: "tpack", harnesses: ["opencode", "codex"], warnings: [] });
    expect(j.packs[0].models).toContainEqual({ name: "haiku-4", harness: "codex", mapped: "haiku-4", status: "unverified" });
    expect(Object.keys(j.packs[0].bindings)).toEqual(["scout"]);
    expect(j.packs[0].bindings.scout).toEqual({ opencode: "generate", codex: "generate" });
    const bad = await cli(project, ["configure", "--show", "ghost"]);
    expect(bad.code).toBe(2);
  });

  it("shows every pack when none is named", async () => {
    const project = await installed();
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    const r = await cli(project, ["configure", "--show"]);
    expect(r.out).toContain(KEY);
    expect(r.out).toContain(OTHER);
  });
});
