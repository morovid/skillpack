import { describe, expect, it } from "vitest";
import { promptBindings } from "../../src/core/prompts/bindings.js";
import { bindingWarnings, computePackConfig, resolveAgentRefs } from "../../src/core/install/configure.js";
import { CANCEL, scriptedPrompts } from "../helpers/prompts.js";
import { CancelledError } from "../../src/core/prompts/index.js";
import type { Bindings } from "../../src/core/bindings.js";
import type { LoadedPack } from "../../src/core/install/fetch-pack.js";
import type { PackConfig } from "../../src/core/project/index.js";

const agents = [
  { name: "scout", description: "Searches", fallback: "a read-only helper" },
  { name: "author", description: "Writes", fallback: "an author" },
];
const g = { kind: "generate" } as const;
const none = { kind: "none" } as const;
const both = ["opencode", "codex"] as const;

describe("promptBindings", () => {
  it("one question per agent when the answer works everywhere (generate / none)", async () => {
    const { prompts, asked } = scriptedPrompts(["generate", "none"]);
    const r = await promptBindings({ agents, harnesses: both, current: {}, prompts });
    expect(asked).toHaveLength(2);
    expect(r.scout).toEqual({ opencode: g, codex: g });
    expect(r.author).toEqual({ opencode: none, codex: none });
    expect(asked[0]!.message).toContain("scout: Searches");
    expect(asked[0]!.options!.map((o) => o.value)).toEqual(["generate", "none", "per-harness"]);
    expect(asked[0]!.options![1]!.hint).toBe("skills will say: a read-only helper");
  });

  it("per harness: built-in agents of each harness, with the current binding as the default", async () => {
    const current: Bindings = { scout: { opencode: { kind: "existing", id: "explore" }, codex: g }, author: { opencode: g, codex: g } };
    const { prompts, asked } = scriptedPrompts(["per-harness", "existing:explore", "existing:explorer", "generate"]);
    const r = await promptBindings({ agents, harnesses: both, current, prompts });
    expect(r.scout).toEqual({ opencode: { kind: "existing", id: "explore" }, codex: { kind: "existing", id: "explorer" } });
    expect(r.author).toEqual({ opencode: g, codex: g });
    expect(asked[0]!.initial).toBe("per-harness"); // not all the same, so the long form is the default
    expect(asked[1]!.message).toBe("scout in OpenCode");
    expect(asked[1]!.initial).toBe("existing:explore");
    expect(asked[1]!.options!.map((o) => o.label)).toEqual(["Generate the pack's agent", 'Use built-in "general"', 'Use built-in "explore"', "None"]);
    expect(asked[2]!.options!.map((o) => o.value)).toEqual(["generate", "existing:default", "existing:worker", "existing:explorer", "none"]);
    expect(asked[2]!.initial).toBe("generate");
    expect(asked[3]!.initial).toBe("generate"); // author: same everywhere
  });

  it("defaults to generate for new agents and to none when everything is none", async () => {
    const { prompts, asked } = scriptedPrompts(["none", "generate"]);
    await promptBindings({ agents, harnesses: both, current: { scout: { opencode: none, codex: none } }, prompts });
    expect(asked[0]!.initial).toBe("none");
    expect(asked[1]!.initial).toBe("generate");
  });

  it("a single harness skips the shortcut question", async () => {
    const { prompts, asked } = scriptedPrompts(["existing:worker"]);
    const r = await promptBindings({ agents: [agents[0]!], harnesses: ["codex"], current: {}, prompts });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.message).toBe("scout in Codex");
    expect(r.scout).toEqual({ codex: { kind: "existing", id: "worker" } });
  });

  it("cancelling aborts", async () => {
    const { prompts } = scriptedPrompts([CANCEL]);
    await expect(promptBindings({ agents, harnesses: both, current: {}, prompts })).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("configure helpers", () => {
  const pack = { agents: [{ name: "scout", description: "d", fallback: "f" }, { name: "code_lead", description: "d", fallback: "f" }] } as unknown as LoadedPack;
  const cfg: PackConfig = { version: "^1", harnesses: ["opencode", "codex"], skills: "*", agents: { scout: { opencode: "generate" } } };

  it("resolves plain, kebab and scoped agent names", () => {
    expect(resolveAgentRefs(["code_lead", "code-lead", "my-pack-code-lead", "scout"], ["scout", "code_lead"], "my_pack")).toEqual(["code_lead", "scout"]);
    expect(() => resolveAgentRefs(["nope"], ["scout"], "p")).toThrow(/no agent "nope"/);
  });

  it("makes every binding explicit and reports what changed", async () => {
    const { packConfig, changes } = await computePackConfig({ pack, cfg, scope: "p", agentRefs: [], harnessFlag: [], mode: { kind: "defaults" } });
    expect(packConfig.agents).toEqual({
      scout: { opencode: "generate", codex: "generate" },
      code_lead: { opencode: "generate", codex: "generate" },
    });
    expect(changes).toEqual([
      { agent: "scout", harness: "codex", from: null, to: "generate" },
      { agent: "code_lead", harness: "opencode", from: null, to: "generate" },
      { agent: "code_lead", harness: "codex", from: null, to: "generate" },
    ]);
  });

  it("--bind applies to the selected harnesses; unknown things are usage errors", async () => {
    const run = (specs: string[], harnessFlag: ("opencode" | "codex")[] = []) =>
      computePackConfig({ pack, cfg, scope: "p", agentRefs: [], harnessFlag, mode: { kind: "binds", specs } });
    const a = await run(["scout=none"], ["codex"]);
    expect(a.packConfig.agents.scout).toEqual({ opencode: "generate", codex: "none" });
    expect((await run(["scout.opencode=existing:explore"])).packConfig.agents.scout!.opencode).toBe("existing:explore");
    await expect(run(["scout=existing:explore"])).rejects.toThrow(/not a built-in Codex/);
    await expect(run(["ghost=none"])).rejects.toThrow(/no agent "ghost"/);
    await expect(run(["scout.opencode=none"], ["codex"])).rejects.toThrow(/isn't one of the selected harnesses/);
    await expect(run(["scout"])).rejects.toThrow(/invalid --bind/);
  });

  it("keeps entries of agents the pack no longer has, and warns about unknown built-ins", async () => {
    const withOld: PackConfig = { ...cfg, agents: { ...cfg.agents, gone: { opencode: "none" } } };
    const { packConfig } = await computePackConfig({ pack, cfg: withOld, scope: "p", agentRefs: [], harnessFlag: [], mode: { kind: "defaults" } });
    expect(packConfig.agents.gone).toEqual({ opencode: "none" });
    expect(bindingWarnings({ ...cfg, agents: { scout: { opencode: "existing:bogus", codex: "existing:explorer" } } })).toEqual([
      'scout (OpenCode): "bogus" is not a built-in OpenCode agent (general, explore)',
    ]);
  });
});
