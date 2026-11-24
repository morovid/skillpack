import { describe, expect, it } from "vitest";
import {
  BindingError, agentIdFor, bindingsFromOptions, formatBinding, parseBinding, parseBindFlag, resolveBindings,
  type Bindings,
} from "../../src/core/bindings.js";
import { createInstallContext, agentPhrase, renderSkill } from "../../src/core/render/index.js";
import type { Harness } from "../../src/core/harness.js";

describe("bindings", () => {
  it("parses and formats", () => {
    for (const s of ["generate", "none", "existing:explore"]) expect(formatBinding(parseBinding(s))).toBe(s);
    expect(() => parseBinding("existing:")).toThrow(BindingError);
    expect(() => parseBinding("maybe")).toThrow(BindingError);
  });
  it("computes agent ids", () => {
    expect(agentIdFor("my_pack", "code_scout", { kind: "generate" })).toBe("my-pack-code-scout");
    expect(agentIdFor("p", "a", { kind: "existing", id: "explore" })).toBe("explore");
    expect(agentIdFor("p", "a", { kind: "none" })).toBeNull();
  });
  it("defaults to generate", () => {
    expect(resolveBindings(["a"], ["opencode", "codex"])).toEqual({
      a: { opencode: { kind: "generate" }, codex: { kind: "generate" } },
    });
  });
  it("parses --bind", () => {
    expect(parseBindFlag("scout.codex=existing:explorer", ["codex"])).toEqual({
      agent: "scout", harness: "codex", binding: { kind: "existing", id: "explorer" },
    });
    expect(() => parseBindFlag("scout", [])).toThrow(BindingError);
    expect(() => parseBindFlag("scout.vim=none", ["codex"])).toThrow(/unknown harness/);
  });
  const base = { agents: ["a", "b", "c"], harnesses: ["opencode", "codex"] as Harness[] };
  it("--agent binds the others to none", () => {
    const b = bindingsFromOptions({ ...base, agentOption: "a,c" });
    expect(b.b).toEqual({ opencode: { kind: "none" }, codex: { kind: "none" } });
    expect(b.a?.codex).toEqual({ kind: "generate" });
    expect(bindingsFromOptions({ ...base, agentOption: "none" }).a?.opencode).toEqual({ kind: "none" });
    expect(bindingsFromOptions({ ...base, agentOption: "*" }).b?.opencode).toEqual({ kind: "generate" });
    expect(() => bindingsFromOptions({ ...base, agentOption: "zzz" })).toThrow(/no agent "zzz"/);
  });
  it("--bind applies after --agent and checks built-ins", () => {
    const b = bindingsFromOptions({ ...base, agentOption: "a", binds: ["b.opencode=existing:explore", "c=none"] });
    expect(b.b?.opencode).toEqual({ kind: "existing", id: "explore" });
    expect(b.b?.codex).toEqual({ kind: "none" });
    expect(() => bindingsFromOptions({ ...base, binds: ["a=existing:explore"] })).toThrow(/not a built-in Codex/);
    expect(() => bindingsFromOptions({ ...base, binds: ["a.codex=existing:explore"] })).toThrow(/Codex/);
    expect(() => bindingsFromOptions({ ...base, harnesses: ["codex"], binds: ["a.opencode=none"] })).toThrow(/unknown harness/);
    expect(() => bindingsFromOptions({ ...base, binds: ["zzz=none"] })).toThrow(/no agent "zzz"/);
  });
});

describe("agentPhrase (R-CFG-7)", () => {
  const g = { kind: "generate" } as const;
  const none = { kind: "none" } as const;
  const ex = (id: string) => ({ kind: "existing", id }) as const;
  const phrase = (bindings: Bindings, harnesses: Harness[] = ["opencode", "codex"]) =>
    agentPhrase({ scope: "sc", agent: "scout", fallback: "a scout", harnesses, bindings });

  it("same ids", () => {
    expect(phrase({ scout: { opencode: g, codex: g } })).toBe("`sc-scout`");
    expect(phrase({ scout: { opencode: ex("default"), codex: ex("default") } })).toBe("`default`");
  });
  it("different ids", () => {
    expect(phrase({ scout: { opencode: ex("explore"), codex: ex("explorer") } })).toBe("`explore` (Codex: `explorer`)");
    expect(phrase({ scout: { opencode: g, codex: ex("explorer") } })).toBe("`sc-scout` (Codex: `explorer`)");
  });
  it("one none shows the fallback in its place", () => {
    expect(phrase({ scout: { opencode: ex("explore"), codex: none } })).toBe("`explore` (Codex: a scout)");
    expect(phrase({ scout: { opencode: none, codex: g } })).toBe("a scout (Codex: `sc-scout`)");
  });
  it("all none and single harness", () => {
    expect(phrase({ scout: { opencode: none, codex: none } })).toBe("a scout");
    expect(phrase({ scout: { codex: ex("worker") } }, ["codex"])).toBe("`worker`");
    expect(phrase({ scout: { opencode: none } }, ["opencode"])).toBe("a scout");
  });
});

describe("install context", () => {
  it("renders skills with prefixed names, links and phrases", () => {
    const ctx = createInstallContext({
      scope: "my_pack",
      skillNames: ["plan_code", "review"],
      agents: new Map([["scout", { fallback: "a scout" }]]),
      harnesses: ["opencode", "codex"],
      bindings: { scout: { opencode: { kind: "existing", id: "explore" }, codex: { kind: "existing", id: "explorer" } } },
    });
    const out = renderSkill(
      {
        name: "review",
        files: [
          {
            path: "SKILL.md",
            mode: 0o644,
            content: Buffer.from(
              '---\nname: review\ndescription: Uses {{agent:scout}}\nmetadata:\n  internal: "true"\n---\nSee {{skill:plan_code}} in {{scope}}: [p](../plan_code/SKILL.md)\n',
            ),
          },
        ],
      },
      ctx,
    );
    expect(out[0]!.path).toBe("my-pack-review/SKILL.md");
    expect(out[0]!.content.toString()).toBe(
      "---\nname: my-pack-review\ndescription: \"Uses `explore` (Codex: `explorer`)\"\n---\nSee my-pack-plan-code in my_pack: [p](../my-pack-plan-code/SKILL.md)\n",
    );
  });
});
