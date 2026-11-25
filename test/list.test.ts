import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initProject, type TestRemotes } from "./helpers/remotes.js";
import { KEY, OTHER, createPackRemotes, makeCli, readJson, snapshot } from "./helpers/project-cli.js";

let remotes: TestRemotes;
let cli: ReturnType<typeof makeCli>;
beforeAll(() => {
  remotes = createPackRemotes();
  cli = makeCli(remotes);
});

const ADD = ["add", "acme/skills@^1.1.0", "-a", "opencode,codex", "-y"];

describe("list", () => {
  it("says so when no packs are configured", async () => {
    const r = await cli(initProject(), ["list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("no packs configured");
  });

  it("shows a pack: scope, source, requested → locked, harnesses, skills and bindings", async () => {
    const project = initProject();
    await cli(project, ADD);
    const r = await cli(project, ["list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`tpack  ${KEY}`);
    expect(r.out).toContain("version    ^1.1.0 → v1.1.0");
    expect(r.out).toContain("harnesses  OpenCode, Codex");
    expect(r.out).toMatch(/tpack-plan-code\s+ok/);
    expect(r.out).toMatch(/tpack-review\s+ok/);
    expect(r.out).toMatch(/scout\s+generate · ok\s+generate · ok/);
    expect(r.out).not.toContain(".opencode/agents/"); // file paths only with --agents
    expect((await cli(project, ["list", "--agents"])).out).toContain(".opencode/agents/tpack-scout.md  ok");
  });

  it("shows two packs", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    const r = await cli(project, ["list"]);
    expect(r.out).toContain(KEY);
    expect(r.out).toContain(OTHER);
    expect(r.out).toContain("other-review");
    expect(r.out).toMatch(/other\s+https:\/\/github.com\/acme\/other/);
  });

  it("flags edited and missing files, and agents of harnesses that aren't detected", async () => {
    const project = initProject();
    await cli(project, ADD);
    const skill = join(project, ".agents/skills/tpack-review/SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nlocal\n");
    rmSync(join(project, ".agents/skills/tpack-plan-code"), { recursive: true });
    rmSync(join(project, ".opencode/agents/tpack-scout.md"));
    rmSync(join(project, ".codex/agents/tpack-author.toml"));
    const before = snapshot(project);
    const r = await cli(project, ["list"], { detected: ["opencode"] });
    expect(r.out).toMatch(/tpack-review\s+edited/);
    expect(r.out).toMatch(/tpack-plan-code\s+missing/);
    expect(r.out).toMatch(/scout\s+generate · missing/);
    expect(r.out).toContain("generate · not generated (harness not detected)");
    expect(snapshot(project)).toEqual(before); // read-only
  });

  it("reports packs in the config but not the lock, and packs in the lock but not the config", async () => {
    const project = initProject();
    await cli(project, ADD);
    const cfg = readJson(project, "skillpack.json");
    cfg.packs[OTHER] = { version: "^1.0.0", harnesses: ["opencode"], skills: "*", agents: {} };
    delete cfg.packs[KEY];
    writeFileSync(join(project, "skillpack.json"), JSON.stringify(cfg));
    const r = await cli(project, ["list"]);
    expect(r.out).toContain("not installed (run skillpack install)");
    expect(r.out).toContain("not locked");
    expect(r.out).toContain(`${KEY}  orphaned (run skillpack install)`);
    expect(r.out).toContain("(scope unknown)");
  });

  it("filters by scope and by source, with details", async () => {
    const project = initProject();
    await cli(project, ADD);
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"]);
    for (const ref of ["tpack", "acme/skills", KEY]) {
      const r = await cli(project, ["list", ref]);
      expect(r.code, ref).toBe(0);
      expect(r.out).toContain(KEY);
      expect(r.out).not.toContain(OTHER);
      expect(r.out).toMatch(/commit     [0-9a-f]{40}/);
      expect(r.out).toContain(".opencode/agents/tpack-author.md  ok");
    }
    const bad = await cli(project, ["list", "nope"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("Configured packs:");
  });

  it("--json prints the full structure", async () => {
    const project = initProject();
    await cli(project, ADD);
    const j = JSON.parse((await cli(project, ["list", "--json"])).out);
    expect(j.orphaned).toEqual([]);
    expect(j.packs[0]).toMatchObject({
      key: KEY, scope: "tpack", scopeExact: true, requested: "^1.1.0", installed: true,
      locked: { ref: "refs/tags/v1.1.0" }, harnesses: ["opencode", "codex"], skills: "*",
    });
    expect(j.packs[0].skillFolders.map((f: { status: string }) => f.status)).toEqual(["ok", "ok"]);
    expect(j.packs[0].agentFiles).toContainEqual({ agent: "scout", harness: "codex", path: ".codex/agents/tpack-scout.toml", status: "ok" });
    expect(existsSync(join(project, "skillpack.models.json"))).toBe(true); // written by add: Codex models are mapped
  });
});
