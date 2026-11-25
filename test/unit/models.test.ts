import { describe, expect, it } from "vitest";
import { createSystemModelSource, parseCodexCatalog, parseOpenCodeModels } from "../../src/core/models/available.js";
import { CommandError } from "../../src/core/exec.js";
import { mapEffort } from "../../src/core/models/effort.js";
import { findMatch, matchesRequested, normalizeModelName } from "../../src/core/models/match.js";
import { requestKey, resolveModels, type ModelRequest } from "../../src/core/models/resolve.js";
import { emptyModels, setModel } from "../../src/core/project/models.js";
import { describeModels } from "../../src/core/install/models-view.js";
import { CANCEL, scriptedPrompts } from "../helpers/prompts.js";
import { fakeModels } from "../helpers/models.js";

describe("normalizeModelName / matchesRequested", () => {
  it("lowercases, maps . _ and spaces to -, drops provider and #variant", () => {
    expect(normalizeModelName("github-copilot/Claude_Sonnet 5.5#high")).toBe("claude-sonnet-5-5");
    expect(normalizeModelName("openrouter/anthropic/claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(normalizeModelName("gpt-6.2-sol")).toBe("gpt-6-2-sol");
  });
  it("matches whole - separated parts in a row", () => {
    expect(matchesRequested("github-copilot/claude-sonnet-5.5", "sonnet-5.5")).toBe(true);
    expect(matchesRequested("claude-sonnet-5-5", "sonnet-5.5")).toBe(true);
    expect(matchesRequested("sonnet-5-50", "sonnet-5.5")).toBe(false);
    expect(matchesRequested("claude-sonnet-5-5-mini", "sonnet-5.5")).toBe(true);
    expect(matchesRequested("openai/gpt-6-2-sol", "gpt-6.2-sol")).toBe(true);
    expect(matchesRequested("gpt-6-sol", "gpt-6.2-sol")).toBe(false);
    expect(matchesRequested("claude-5-sonnet", "sonnet-5")).toBe(false); // order matters
    expect(matchesRequested("x", "")).toBe(false);
  });
});

describe("findMatch", () => {
  const m = (...names: string[]) => names.map((name) => ({ name }));
  it("tries the requested names in order; the first with a match wins", () => {
    const avail = m("a/gpt-6-2-sol", "b/claude-sonnet-5-5");
    expect(findMatch(["sonnet-5.5", "gpt-6.2-sol"], avail)).toMatchObject({ name: "sonnet-5.5", candidates: [{ name: "b/claude-sonnet-5-5" }] });
    expect(findMatch(["opus-9", "gpt-6.2-sol"], avail)).toMatchObject({ name: "gpt-6.2-sol" });
    expect(findMatch(["opus-9"], avail)).toBeNull();
  });
  it("several providers are several candidates, sorted", () => {
    const r = findMatch(["sonnet-5.5"], m("z/claude-sonnet-5.5", "a/claude-sonnet-5.5", "a/claude-sonnet-5.5-mini"));
    expect(r!.candidates.map((c) => c.name)).toEqual(["a/claude-sonnet-5.5", "a/claude-sonnet-5.5-mini", "z/claude-sonnet-5.5"]);
  });
  it("exact names win over longer ones", () => {
    const r = findMatch(["gpt-6-luna"], m("p/gpt-6-luna", "p/gpt-6-luna-mini"));
    expect(r!.candidates.map((c) => c.name)).toEqual(["p/gpt-6-luna"]);
  });
});

describe("mapEffort", () => {
  it("Codex: as is, with a warning when the model's efforts don't list it", () => {
    expect(mapEffort("codex", "high")).toEqual({ effort: "high" });
    expect(mapEffort("codex", "max", { efforts: ["low", "high"] }).warning).toMatch(/isn't listed/);
    expect(mapEffort("codex", undefined)).toEqual({});
  });
  it("OpenCode: the variant of the same name, nearest otherwise, unverified when unknown", () => {
    expect(mapEffort("opencode", "high", { variants: ["low", "high"] })).toEqual({ variant: "high" });
    expect(mapEffort("opencode", "xhigh", { variants: ["low", "medium", "high"] })).toMatchObject({ variant: "high", warning: expect.stringContaining('nearest, "high"') });
    expect(mapEffort("opencode", "medium", { variants: ["low", "high"] }).variant).toBe("low"); // tie: the lower one
    expect(mapEffort("opencode", "high", { variants: [] }).variant).toBeUndefined();
    expect(mapEffort("opencode", "high")).toMatchObject({ variant: "high", warning: expect.stringContaining("without verification") });
    expect(mapEffort("opencode", undefined)).toEqual({});
  });
});

describe("available models", () => {
  it("parses opencode models and ignores noise", () => {
    expect(parseOpenCodeModels("github-copilot/claude-sonnet-5.5\n\nwarning: something\n  deepseek/deepseek-v4-pro  \ngithub-copilot/claude-sonnet-5.5\n")).toEqual([
      { name: "github-copilot/claude-sonnet-5.5", provider: "github-copilot" },
      { name: "deepseek/deepseek-v4-pro", provider: "deepseek" },
    ]);
  });
  it("parses the codex catalog: listed models and their efforts", () => {
    const json = JSON.stringify({ models: [
      { slug: "gpt-6-sol", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] },
      { slug: "hidden", visibility: "hide" },
      { slug: "gpt-5.5" },
    ] });
    expect(parseCodexCatalog(json)).toEqual([{ name: "gpt-6-sol", efforts: ["low", "high"] }, { name: "gpt-5.5" }]);
  });
  it("the system source reads each harness once, and maps failures to unavailable / unverified", async () => {
    const calls: string[] = [];
    const run = async (cmd: string) => {
      calls.push(cmd);
      if (cmd === "opencode") return "p/m-1\n";
      throw new CommandError("codex was not found on PATH", "not-found");
    };
    const source = createSystemModelSource({}, run as never);
    expect(await source.list("opencode")).toEqual({ status: "ok", models: [{ name: "p/m-1", provider: "p" }] });
    await source.list("opencode");
    expect(await source.list("codex")).toMatchObject({ status: "unverified", reason: expect.stringContaining("not found") });
    expect(calls).toEqual(["opencode", "codex"]);
    const broken = createSystemModelSource({}, (async () => { throw new CommandError("failed", "failed"); }) as never);
    expect((await broken.list("opencode")).status).toBe("unavailable");
  });
});

const req = (agent: string, harness: "opencode" | "codex", names: string[], effort?: string): ModelRequest => ({ agent, harness, names, ...(effort ? { effort } : {}) });
const run = (requests: ModelRequest[], source = fakeModels(), extra: Partial<Parameters<typeof resolveModels>[0]> = {}) =>
  resolveModels({ packKey: "https://p", requests, models: emptyModels(), source, ...extra });

describe("resolveModels", () => {
  it("one match: used and saved; OpenCode gets the variant, Codex the model name; effort warning once per pack and harness", async () => {
    const source = fakeModels({ opencode: ["gh/claude-sonnet-5.5", "gh/gpt-9"], codex: ["gpt-6.2-sol"] });
    const r = await run([req("a", "opencode", ["sonnet-5.5"], "high"), req("b", "opencode", ["sonnet-5.5"], "high"), req("a", "codex", ["gpt-6.2-sol"], "high")], source);
    expect(r.concrete.get(requestKey("a", "opencode"))).toBe("gh/claude-sonnet-5.5#high");
    expect(r.concrete.get(requestKey("b", "opencode"))).toBe("gh/claude-sonnet-5.5#high");
    expect(r.concrete.get(requestKey("a", "codex"))).toBe("gpt-6.2-sol");
    expect(r.models.packs["https://p"]).toEqual({ "sonnet-5.5": { opencode: "gh/claude-sonnet-5.5" }, "gpt-6.2-sol": { codex: "gpt-6.2-sol" } });
    expect(r.changed).toBe(true);
    expect(r.warnings.filter((w) => w.message.includes("without verification"))).toHaveLength(1);
    expect(source.calls.filter((h) => h === "opencode")).toHaveLength(1);
  });

  it("no effort means no variant", async () => {
    const r = await run([req("a", "opencode", ["sonnet-5.5"])], fakeModels({ opencode: ["gh/claude-sonnet-5.5"] }));
    expect(r.concrete.get(requestKey("a", "opencode"))).toBe("gh/claude-sonnet-5.5");
    expect(r.warnings).toEqual([]);
  });

  it("an existing mapping is used as is, even if the model is gone (warning), and not for other packs", async () => {
    const models = setModel(emptyModels(), "https://p", "sonnet-5.5", "opencode", "old/sonnet");
    const r = await run([req("a", "opencode", ["sonnet-5.5"])], fakeModels({ opencode: ["gh/claude-sonnet-5.5"] }), { models });
    expect(r.concrete.get(requestKey("a", "opencode"))).toBe("old/sonnet");
    expect(r.warnings[0]!.message).toContain('"old/sonnet" for "sonnet-5.5" is no longer listed');
    expect(r.changed).toBe(false);
    const other = await run([req("a", "opencode", ["sonnet-5.5"])], fakeModels({ opencode: ["gh/claude-sonnet-5.5"] }), { models, packKey: "https://other" });
    expect(other.concrete.get(requestKey("a", "opencode"))).toBe("gh/claude-sonnet-5.5");
  });

  it("ambiguous: picks the first by name with a warning, or asks", async () => {
    const source = fakeModels({ opencode: ["z/claude-sonnet-5.5", "a/claude-sonnet-5.5"] });
    const auto = await run([req("a", "opencode", ["sonnet-5.5"])], source);
    expect(auto.concrete.get(requestKey("a", "opencode"))).toBe("a/claude-sonnet-5.5");
    expect(auto.warnings[0]!.message).toContain("matches several OpenCode models (a/claude-sonnet-5.5, z/claude-sonnet-5.5); using a/claude-sonnet-5.5");
    const { prompts, asked } = scriptedPrompts(["z/claude-sonnet-5.5"]);
    const asking = await run([req("a", "opencode", ["sonnet-5.5"])], source, { prompts });
    expect(asking.concrete.get(requestKey("a", "opencode"))).toBe("z/claude-sonnet-5.5");
    expect(asking.warnings).toEqual([]);
    expect(asked[0]!.options!.map((o) => o.value)).toEqual(["a/claude-sonnet-5.5", "z/claude-sonnet-5.5"]);
  });

  it("no match: generated without a model with a warning; strict fails", async () => {
    const source = fakeModels({ opencode: ["x/other-model"] });
    const r = await run([req("scout", "opencode", ["sonnet-5.5", "gpt-6"], "high")], source);
    expect(r.concrete.size).toBe(0);
    expect(r.warnings[0]!.message).toContain('no OpenCode model matches "sonnet-5.5" or "gpt-6" (asked by scout); generated without a model');
    expect(r.failures).toEqual([]);
    const strict = await run([req("scout", "opencode", ["sonnet-5.5"])], source, { strict: true });
    expect(strict.failures).toEqual(['scout: no OpenCode model matches "sonnet-5.5"']);
  });

  it("no match, interactive: pick, type or skip", async () => {
    const source = fakeModels({ opencode: ["x/other-model"] });
    const pick = scriptedPrompts(["x/other-model"]);
    expect((await run([req("a", "opencode", ["sonnet-5.5"])], source, { prompts: pick.prompts })).concrete.get(requestKey("a", "opencode"))).toBe("x/other-model");
    expect(pick.asked[0]!.options!.map((o) => o.label).slice(0, 2)).toEqual(["Skip: generate without a model", "Type a model name…"]);
    const typed = scriptedPrompts(["\0type", "my/model"]);
    const r = await run([req("a", "opencode", ["sonnet-5.5"])], source, { prompts: typed.prompts });
    expect(r.concrete.get(requestKey("a", "opencode"))).toBe("my/model");
    expect(r.models.packs["https://p"]).toEqual({ "sonnet-5.5": { opencode: "my/model" } });
    const skip = scriptedPrompts(["\0skip"]);
    const s = await run([req("a", "opencode", ["sonnet-5.5"])], source, { prompts: skip.prompts });
    expect(s.concrete.size).toBe(0);
    expect(s.warnings).toHaveLength(1);
    await expect(run([req("a", "opencode", ["sonnet-5.5"])], source, { prompts: scriptedPrompts([CANCEL]).prompts })).rejects.toThrow("cancelled");
  });

  it("OpenCode's list unavailable: warning, no model; strict fails", async () => {
    const r = await run([req("a", "opencode", ["sonnet-5.5"]), req("b", "opencode", ["haiku-4"])], fakeModels());
    expect(r.concrete.size).toBe(0);
    expect(r.warnings).toHaveLength(1); // once per harness
    expect(r.warnings[0]!.message).toContain("OpenCode's model list isn't available");
    expect((await run([req("a", "opencode", ["sonnet-5.5"])], fakeModels(), { strict: true })).failures[0]).toContain("model list isn't available");
  });

  it("Codex unverified: the first requested name as given, saved, with a warning (not a strict failure)", async () => {
    const r = await run([req("a", "codex", ["gpt-6.2-sol", "other"], "high")], fakeModels(), { strict: true });
    expect(r.concrete.get(requestKey("a", "codex"))).toBe("gpt-6.2-sol");
    expect(r.models.packs["https://p"]).toEqual({ "gpt-6.2-sol": { codex: "gpt-6.2-sol" } });
    expect(r.warnings[0]!.message).toContain('Codex models can\'t be verified');
    expect(r.failures).toEqual([]);
  });

  it("Codex with a catalog: matches it; a name it doesn't list is a no-match like in OpenCode", async () => {
    const source = fakeModels({ codex: [{ name: "gpt-6-sol", efforts: ["low", "high"] }] });
    const r = await run([req("a", "codex", ["gpt-6.sol"], "max"), req("b", "codex", ["gpt-7"])], source);
    expect(r.concrete.get(requestKey("a", "codex"))).toBe("gpt-6-sol");
    expect(r.warnings.some((w) => w.message.includes('effort "max" isn\'t listed'))).toBe(true);
    expect(r.concrete.has(requestKey("b", "codex"))).toBe(false);
    expect(r.warnings.some((w) => w.message.includes('no Codex model matches "gpt-7"'))).toBe(true);
    expect((await run([req("b", "codex", ["gpt-7"])], source, { strict: true })).failures).toEqual(['b: no Codex model matches "gpt-7"']);
  });
});

describe("describeModels", () => {
  it("reports mapped, unavailable, unverified, available and not mapped", async () => {
    let models = setModel(emptyModels(), "https://p", "a", "opencode", "gh/a");
    models = setModel(models, "https://p", "b", "opencode", "gh/gone");
    models = setModel(models, "https://p", "c", "codex", "c");
    const source = fakeModels({ opencode: ["gh/a", "gh/d-model"], codex: "unverified" });
    const rows = await describeModels({
      packKey: "https://p",
      models,
      source,
      requests: [req("x", "opencode", ["a"]), req("x", "opencode", ["b"]), req("x", "opencode", ["d-model"]), req("x", "opencode", ["zzz"]), req("x", "codex", ["c"])],
    });
    expect(rows.map((r) => `${r.name}/${r.harness}/${r.status}`)).toEqual(["a/opencode/mapped", "b/opencode/unavailable", "c/codex/unverified", "d-model/opencode/available", "zzz/opencode/not mapped"]);
    const fromFile = await describeModels({ packKey: "https://p", models, source, requests: null });
    expect(fromFile.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });
});
