import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initProject, write, type TestRemotes } from "./helpers/remotes.js";
import { KEY, OTHER, createPackRemotes, git, makeCli, readJson, snapshot } from "./helpers/project-cli.js";
import { fakeModels } from "./helpers/models.js";
import { scriptedPrompts } from "./helpers/prompts.js";

let remotes: TestRemotes;
let cli: ReturnType<typeof makeCli>;
const MODELS_KEY = "https://github.com/acme/modelpack";

beforeAll(() => {
  remotes = createPackRemotes();
  remotes.add("acme/modelpack", [
    { apply: (w) => {
      write(w, "skillpack.pack.json", JSON.stringify({ name: "mp" }));
      write(w, "src/skills/one/SKILL.md", "---\nname: one\ndescription: One.\nmetadata:\n  internal: \"true\"\n---\n\nUse {{agent:helper}}.\n");
      write(w, "src/agents/helper/manifest.json", JSON.stringify({ description: "Helper.", fallback: "a helper", model: { name: "sonnet-5.5", effort: "low" } }));
      write(w, "src/agents/helper/instructions.md", "Help.\n");
    }, tag: "v1.0.0" },
  ]);
  cli = makeCli(remotes);
});

const ADD = ["add", "acme/skills@^1.1.0", "-a", "opencode,codex", "-y"];
const read = (p: string, f: string) => readFileSync(join(p, f), "utf8");
const exclude = (p: string) => read(p, ".git/info/exclude");
const mappings = (p: string, key = KEY) => readJson(p, "skillpack.models.json").packs[key];
const lockSkills = (p: string, key = KEY) => readJson(p, "skillpack-lock.json").packs[key].skills;

const GOOD = () =>
  fakeModels({
    opencode: ["github-copilot/claude-sonnet-5.5", "github-copilot/claude-haiku-4"],
    codex: [{ name: "gpt-6.2-sol", efforts: ["low", "medium", "high"] }, "haiku-4"],
  });

describe("models: add", () => {
  it("matches models, writes the mappings, #variant for OpenCode, effort for Codex, and excludes the models file", async () => {
    const project = initProject();
    const r = await cli(project, ADD, { models: GOOD() });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(mappings(project)).toEqual({
      "haiku-4": { opencode: "github-copilot/claude-haiku-4", codex: "haiku-4" },
      "sonnet-5.5": { opencode: "github-copilot/claude-sonnet-5.5" },
      "gpt-6.2-sol": { codex: "gpt-6.2-sol" },
    });
    const oc = read(project, ".opencode/agents/tpack-author.md");
    expect(oc).toContain("model: github-copilot/claude-sonnet-5.5#high");
    expect(oc).toContain("# binding: generate; model: github-copilot/claude-sonnet-5.5; effort: high");
    expect(read(project, ".opencode/agents/tpack-scout.md")).toContain("model: github-copilot/claude-haiku-4\n");
    const cx = read(project, ".codex/agents/tpack-author.toml");
    expect(cx).toContain('model = "gpt-6.2-sol"');
    expect(cx).toContain('model_reasoning_effort = "high"');
    expect(cx).toContain("# binding: generate; model: gpt-6.2-sol; effort: high");
    expect(exclude(project)).toContain("/skillpack.models.json");
    expect(r.out).toContain("+ skillpack.models.json  (models)");
    expect(r.out).toContain("effort \"high\" is written as the variant \"high\" without verification");
    expect(r.out).not.toContain("model matching isn't available yet");
  });

  it("existing mappings are honored (and kept when the model is gone, with a warning)", async () => {
    const project = initProject();
    writeFileSync(join(project, "skillpack.models.json"), JSON.stringify({ packs: { [KEY]: { "sonnet-5.5": { opencode: "my/sonnet-custom" } } } }));
    const r = await cli(project, ADD, { models: GOOD() });
    expect(r.code).toBe(0);
    expect(read(project, ".opencode/agents/tpack-author.md")).toContain("model: my/sonnet-custom#high");
    expect(mappings(project)["sonnet-5.5"]).toEqual({ opencode: "my/sonnet-custom" });
    expect(r.out).toContain('the mapped model "my/sonnet-custom" for "sonnet-5.5" is no longer listed by OpenCode; keeping it');
  });

  it("ambiguous with -y: deterministic pick and a warning; interactive: asks", async () => {
    const source = () => fakeModels({ opencode: ["z/claude-sonnet-5.5", "a/claude-sonnet-5.5", "a/claude-haiku-4"], codex: "unverified" });
    const p1 = initProject();
    const r = await cli(p1, ADD, { models: source() });
    expect(r.code).toBe(0);
    expect(mappings(p1)["sonnet-5.5"].opencode).toBe("a/claude-sonnet-5.5");
    expect(r.out).toContain("matches several OpenCode models (a/claude-sonnet-5.5, z/claude-sonnet-5.5); using a/claude-sonnet-5.5");

    const p2 = initProject();
    const { prompts, asked } = scriptedPrompts([
      ["opencode"], // harnesses
      "generate", "generate", "generate", // bindings: author, code_lead, scout (single harness)
      "z/claude-sonnet-5.5", // ambiguity
    ]);
    const i = await cli(p2, ["add", "acme/skills@^1.1.0", "-s", "*"], { models: source(), prompts });
    expect(i.code).toBe(0);
    expect(asked.some((a) => a.message.startsWith('Which model for "sonnet-5.5" in OpenCode?'))).toBe(true);
    expect(mappings(p2)["sonnet-5.5"].opencode).toBe("z/claude-sonnet-5.5");
  });

  it("no match: the agent is generated without a model, with a warning; --strict fails and writes nothing", async () => {
    const source = () => fakeModels({ opencode: ["x/unrelated"], codex: ["gpt-6.2-sol"] });
    const project = initProject();
    const r = await cli(project, ["add", "acme/skills@^1.1.0", "-a", "opencode", "-y"], { models: source() });
    expect(r.code).toBe(0);
    expect(read(project, ".opencode/agents/tpack-author.md")).not.toMatch(/^model:/m);
    expect(read(project, ".opencode/agents/tpack-author.md")).toContain("# binding: generate; model: none; effort: default");
    expect(r.out).toContain('no OpenCode model matches "sonnet-5.5" or "gpt-6.2-sol" (asked by author); generated without a model: it will use the parent session\'s model, which can cost more');
    expect(existsSync(join(project, "skillpack.models.json"))).toBe(false);

    const strict = initProject();
    const before = snapshot(strict);
    const f = await cli(strict, ["add", "acme/skills@^1.1.0", "-a", "opencode", "-y", "--strict"], { models: source() });
    expect(f.code).toBe(1);
    expect(f.err).toContain('model problems (--strict); nothing written');
    expect(f.err).toContain('author: no OpenCode model matches "sonnet-5.5" or "gpt-6.2-sol"');
    expect(snapshot(strict)).toEqual(before);
    expect(existsSync(join(strict, "skillpack.json"))).toBe(false);
  });

  it("OpenCode's list unavailable: warning and no model; --strict fails", async () => {
    const project = initProject();
    const r = await cli(project, ["add", "acme/skills@^1.1.0", "-a", "opencode", "-y"], { models: fakeModels() });
    expect(r.code).toBe(0);
    expect(r.out).toContain("OpenCode's model list isn't available");
    expect(read(project, ".opencode/agents/tpack-author.md")).not.toMatch(/^model:/m);
    const strict = await cli(initProject(), ["add", "acme/skills@^1.1.0", "-a", "opencode", "-y", "--strict"], { models: fakeModels() });
    expect(strict.code).toBe(1);
    expect(strict.err).toContain("model list isn't available");
  });

  it("Codex unverified: the requested name is used as given and saved, with a warning; --strict doesn't fail on it", async () => {
    const project = initProject();
    const r = await cli(project, ["add", "acme/skills@^1.1.0", "-a", "codex", "-y", "--strict"], { models: fakeModels({ codex: "unverified" }) });
    expect(r.code).toBe(0);
    expect(read(project, ".codex/agents/tpack-author.toml")).toContain('model = "sonnet-5.5"');
    expect(mappings(project)["sonnet-5.5"]).toEqual({ codex: "sonnet-5.5" });
    expect(r.out).toContain("Codex models can't be verified");
  });

  it("skills never depend on models: the lock hashes are the same with and without a models file", async () => {
    const a = initProject();
    await cli(a, ADD, { models: GOOD() });
    const b = initProject();
    await cli(b, ADD, { models: fakeModels() });
    expect(existsSync(join(b, "skillpack.models.json"))).toBe(true); // Codex mapped as given
    expect(lockSkills(a)).toEqual(lockSkills(b));
  });

  it("mappings are per pack: another pack's mapping isn't reused", async () => {
    const project = initProject();
    writeFileSync(join(project, "skillpack.models.json"), JSON.stringify({ packs: { [KEY]: { "sonnet-5.5": { opencode: "mine/pinned-sonnet" } } } }));
    expect((await cli(project, ["add", "acme/modelpack", "-a", "opencode", "-y"], { models: GOOD() })).code).toBe(0);
    expect(mappings(project, MODELS_KEY)["sonnet-5.5"].opencode).toBe("github-copilot/claude-sonnet-5.5");
    expect(mappings(project, KEY)["sonnet-5.5"].opencode).toBe("mine/pinned-sonnet");
    expect(read(project, ".opencode/agents/mp-helper.md")).toContain("model: github-copilot/claude-sonnet-5.5#low");
  });
});

describe("models: install, sync and frozen", () => {
  async function clone(models = GOOD()) {
    const project = initProject();
    expect((await cli(project, ADD, { models })).code).toBe(0);
    git(remotes, project, "add", "-A");
    git(remotes, project, "commit", "-q", "-m", "init");
    for (const d of [".opencode", ".codex"]) rmSync(join(project, d), { recursive: true, force: true });
    rmSync(join(project, "skillpack.models.json"));
    writeFileSync(join(project, ".git/info/exclude"), "");
    return project;
  }

  it("a fresh clone has no models file: install matches, writes it, excludes it, and git stays clean", async () => {
    const project = await clone();
    expect(git(remotes, project, "status", "--porcelain")).toBe("");
    const r = await cli(project, ["install"], { models: GOOD() });
    expect(r.code).toBe(0);
    expect(mappings(project)["sonnet-5.5"]).toEqual({ opencode: "github-copilot/claude-sonnet-5.5" });
    expect(read(project, ".opencode/agents/tpack-author.md")).toContain("model: github-copilot/claude-sonnet-5.5#high");
    expect(exclude(project)).toContain("/skillpack.models.json");
    expect(git(remotes, project, "status", "--porcelain")).toBe("");
  });

  it("install --frozen-lockfile never matches models or writes the models file", async () => {
    const project = await clone();
    const source = GOOD();
    const r = await cli(project, ["install", "--frozen-lockfile"], { models: source });
    expect(r.code).toBe(0);
    expect(source.calls).toEqual([]);
    expect(existsSync(join(project, "skillpack.models.json"))).toBe(false);
    expect(existsSync(join(project, ".opencode"))).toBe(false);
  });

  it("install --strict fails without writing when a model can't be matched", async () => {
    const project = await clone();
    const before = snapshot(project);
    const r = await cli(project, ["install", "--strict"], { models: fakeModels({ opencode: ["x/unrelated"], codex: ["gpt-6.2-sol"] }) });
    expect(r.code).toBe(1);
    expect(r.err).toContain("model problems (--strict)");
    expect(snapshot(project)).toEqual(before);
  });

  it("sync picks up a hand-edited models file: only agent files change, skills stay", async () => {
    const project = initProject();
    await cli(project, ADD, { models: GOOD() });
    const hashes = lockSkills(project);
    const models = readJson(project, "skillpack.models.json");
    models.packs[KEY]["sonnet-5.5"].opencode = "github-copilot/claude-sonnet-5";
    writeFileSync(join(project, "skillpack.models.json"), JSON.stringify(models));
    const r = await cli(project, ["sync"], { models: GOOD() });
    expect(r.code).toBe(0);
    expect(read(project, ".opencode/agents/tpack-author.md")).toContain("model: github-copilot/claude-sonnet-5#high");
    expect(lockSkills(project)).toEqual(hashes);
    expect(r.out).not.toMatch(/updated\s+\.agents\/skills/);
    expect(r.out).toContain("agents (OpenCode): tpack-author");
  });
});

describe("models: configure", () => {
  it("--model sets a mapping; only the affected agent files change and skill hashes stay", async () => {
    const project = initProject();
    await cli(project, ADD, { models: GOOD() });
    const hashes = lockSkills(project);
    const r = await cli(project, ["configure", "tpack", "--model", "sonnet-5.5=opencode:github-copilot/claude-opus-5.5"], { models: GOOD() });
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(mappings(project)["sonnet-5.5"].opencode).toBe("github-copilot/claude-opus-5.5");
    expect(read(project, ".opencode/agents/tpack-author.md")).toContain("model: github-copilot/claude-opus-5.5#high");
    expect(lockSkills(project)).toEqual(hashes);
    expect(r.out).toContain("model sonnet-5.5 (OpenCode): github-copilot/claude-sonnet-5.5 → github-copilot/claude-opus-5.5");
    expect(r.out).not.toContain("Commit:"); // nothing committed changes: the models file is local
    expect((await cli(project, ["configure", "tpack", "--model", "nope=opencode:a/b"], { models: GOOD() })).code).toBe(2);
    expect((await cli(project, ["configure", "tpack", "--model", "sonnet-5.5=opencode:nodash"], { models: GOOD() })).code).toBe(2);
  });

  it("--models asks per model name and harness (interactive)", async () => {
    const project = initProject();
    await cli(project, ["add", "acme/modelpack", "-a", "opencode", "-y"], { models: GOOD() });
    const { prompts, asked } = scriptedPrompts(["github-copilot/claude-haiku-4"]);
    const r = await cli(project, ["configure", "mp", "--models"], { models: GOOD(), prompts });
    expect(r.code).toBe(0);
    expect(asked[0]!.message).toBe('Model for "sonnet-5.5" in OpenCode (now github-copilot/claude-sonnet-5.5)');
    expect(asked[0]!.options![0]).toMatchObject({ label: "Keep github-copilot/claude-sonnet-5.5" });
    expect(mappings(project, MODELS_KEY)["sonnet-5.5"].opencode).toBe("github-copilot/claude-haiku-4");
    expect((await cli(project, ["configure", "mp", "--models"], { models: GOOD() })).code).toBe(2); // needs a terminal
  });

  it("--show lists the models with their status", async () => {
    const project = initProject();
    await cli(project, ADD, { models: GOOD() });
    const r = await cli(project, ["configure", "tpack", "--show"], { models: GOOD() });
    expect(r.out).toMatch(/sonnet-5\.5\s+OpenCode\s+github-copilot\/claude-sonnet-5\.5\s+mapped/);
    expect(r.out).toMatch(/gpt-6\.2-sol\s+Codex\s+gpt-6\.2-sol\s+mapped/);
    const gone = await cli(project, ["configure", "tpack", "--show"], { models: fakeModels({ opencode: ["x/y"], codex: "unverified" }) });
    expect(gone.out).toMatch(/sonnet-5\.5\s+OpenCode\s+github-copilot\/claude-sonnet-5\.5\s+unavailable/);
    expect(gone.out).toMatch(/gpt-6\.2-sol\s+Codex\s+gpt-6\.2-sol\s+unverified/);
  });
});

describe("models: another pack in the project", () => {
  it("OTHER pack without models doesn't create mappings", async () => {
    const project = initProject();
    await cli(project, ["add", "acme/other", "-a", "opencode", "-y"], { models: GOOD() });
    expect(existsSync(join(project, "skillpack.models.json"))).toBe(false);
    expect(OTHER).toContain("other");
  });
});
