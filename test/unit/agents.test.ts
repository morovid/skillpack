import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  generateAgent, normalizeCapabilities, parseAgentHeader, verifyAgentHash, type AgentSpec, type GeneratedAgent,
} from "../../src/core/agents/index.js";
import type { Binding } from "../../src/core/bindings.js";
import type { Harness } from "../../src/core/harness.js";

const g: Binding = { kind: "generate" };
const none: Binding = { kind: "none" };
const ex = (id: string): Binding => ({ kind: "existing", id });

const spec = (name: string, o: Partial<AgentSpec> & { caps?: Record<string, unknown> } = {}): AgentSpec => {
  const { caps, ...rest } = o;
  return {
    name,
    description: `Agent ${name}.`,
    fallback: `a ${name}`,
    mode: "subagent",
    modelNames: [],
    spawn: [],
    capabilities: normalizeCapabilities(caps),
    instructions: `You are ${name}.\nAsk {{agent:scout}} via {{skill:plan_code}} in {{scope}}.\n`,
    ...rest,
  };
};

function gen(
  harness: Harness,
  agent: AgentSpec,
  bindings: Record<string, Binding>,
  model: { concrete?: string; requested?: string[]; effort?: string } = {},
  others: AgentSpec[] = [],
): GeneratedAgent {
  const all = new Map([agent, spec("scout"), ...others].map((a) => [a.name, a] as const));
  return generateAgent(harness, {
    pack: { source: "https://github.com/morovid/skills", version: "v1.0.0", scope: "my_pack" },
    agentName: agent.name,
    agents: all,
    bindings: { [agent.name]: g, scout: g, ...bindings },
    model: { requested: model.requested ?? [], ...(model.concrete ? { concrete: model.concrete } : {}), ...(model.effort ? { effort: model.effort } : {}) },
  });
}

const frontmatter = (md: string) => parseYaml(md.split("\n---\n")[0]!.slice(4)) as Record<string, unknown>;
const perms = (md: string) => (frontmatter(md).permissions as { action: string; resource: string; effect: string }[]).map((p) => `${p.effect} ${p.action} ${p.resource}`);

describe("normalizeCapabilities", () => {
  it("applies defaults and normalizes scoped values", () => {
    const c = normalizeCapabilities({ edit: { allow: ["a/*"] }, shell: true, mcp: ["x"] });
    expect(c).toMatchObject({ read: true, search: true, skills: true, web: false, questions: false });
    expect(c.edit).toEqual({ enabled: true, allow: ["a/*"], deny: [] });
    expect(c.shell).toEqual({ enabled: true, allow: null, deny: [] });
    expect(c.mcp).toEqual({ kind: "servers", servers: ["x"] });
    expect(normalizeCapabilities(undefined).edit.enabled).toBe(false);
    expect(normalizeCapabilities({ mcp: true }).mcp).toEqual({ kind: "all" });
  });
});

describe("OpenCode generator", () => {
  it("generates valid frontmatter, permissions deny-first, scoped denials last", () => {
    const a = spec("author", { caps: { edit: { allow: ["specs/*"], deny: ["specs/x/*"] }, shell: { allow: ["git log *"], deny: ["git push *"] }, web: true, questions: true, mcp: ["gh"] }, spawn: ["scout", "other"] });
    const out = gen("opencode", a, { scout: ex("explore"), other: g }, { concrete: "gh/claude-sonnet-5.5#high" }, [spec("other")]);
    expect(out.path).toBe(".opencode/agents/my-pack-author.md");
    const fm = frontmatter(out.content);
    expect(fm).toMatchObject({ description: "Agent author.", mode: "subagent", model: "gh/claude-sonnet-5.5#high" });
    expect(perms(out.content)).toEqual([
      "deny * *", "allow read *", "allow glob *", "allow grep *", "allow edit specs/*", "allow shell git log *",
      "allow webfetch *", "allow websearch *", "allow skill *", "allow question *", "allow gh_* *", "allow subagent explore",
      "allow subagent my-pack-other", "deny edit specs/x/*", "deny shell git push *",
    ]);
    expect(out.content).toContain("# binding: generate; model: gh/claude-sonnet-5.5; effort: default");
    expect(out.content).toContain("Ask `explore` via my-pack-plan-code in my_pack.");
    expect(out.warnings).toEqual([]);
  });

  it("omits model and adds a comment without a concrete model; omits none-bound spawn targets", () => {
    const a = spec("author", { spawn: ["scout"], caps: { skills: false } });
    const out = gen("opencode", a, { scout: none }, { requested: ["sonnet-5.5", "gpt-6.2-sol"], effort: "high" });
    expect(frontmatter(out.content).model).toBeUndefined();
    expect(out.content).toContain("# model: sonnet-5.5, gpt-6.2-sol (effort high) — mapped at install");
    expect(perms(out.content).some((p) => p.includes("subagent"))).toBe(false);
    expect(perms(out.content).some((p) => p.includes("skill"))).toBe(false);
    expect(out.content).toContain("Ask a scout via"); // fallback, not backticked
    expect(out.content).toContain("# binding: generate; model: sonnet-5.5; effort: high");
  });

  it("warns for mcp: true and keeps primary mode", () => {
    const out = gen("opencode", spec("lead", { mode: "primary", caps: { mcp: true } }), {});
    expect(out.warnings.map((w) => w.kind)).toEqual(["mcp"]);
    expect(frontmatter(out.content).mode).toBe("primary");
    expect(perms(out.content).some((p) => p.includes("_*"))).toBe(false);
  });

  it("refuses agents that are not bound to generate", () => {
    expect(() => gen("opencode", spec("x"), { x: none })).toThrow(/not bound to generate/);
  });
});

describe("Codex generator", () => {
  it("generates the sample shape with restrictions", () => {
    const a = spec("author", { caps: { skills: false, edit: { allow: ["specs/*"] }, shell: { allow: ["git diff *", "git log *"] } }, spawn: ["scout"] });
    const out = gen("codex", a, { scout: ex("explorer") }, { requested: ["sonnet-5.5", "gpt-6.2-sol"], effort: "high" });
    expect(out.path).toBe(".codex/agents/my-pack-author.toml");
    const t = parseToml(out.content) as Record<string, any>;
    expect(t).toMatchObject({ name: "my-pack-author", description: "Agent author.", model: "sonnet-5.5", model_reasoning_effort: "high", skills: { include_instructions: false } });
    expect(t.features).toBeUndefined();
    expect(t.developer_instructions).toContain("Ask `explorer` via my-pack-plan-code in my_pack.");
    expect(t.developer_instructions).toContain("Restrictions (not enforced by Codex; follow them strictly):\n- Edit only files matching specs/*.\n- Run only these shell commands: git diff, git log.");
    expect(t.developer_instructions).toContain("- Start only these agents: explorer.");
    expect(out.warnings.every((w) => w.kind === "unenforced")).toBe(true);
    expect(out.warnings.map((w) => w.message)).toContain("Start only these agents: explorer.");
    expect(out.content).toContain("# binding: generate; model: sonnet-5.5; effort: high");
  });

  it("prefers the concrete model, switches shell off, and flags primary mode", () => {
    const out = gen("codex", spec("lead", { mode: "all", caps: { web: true, mcp: true, questions: true, edit: true } }), { scout: none }, { concrete: "gpt-6.2-sol", requested: ["a"] });
    const t = parseToml(out.content) as Record<string, any>;
    expect(t.model).toBe("gpt-6.2-sol");
    expect(t.model_reasoning_effort).toBeUndefined();
    expect(t.features).toEqual({ shell_tool: false });
    expect(t.skills).toBeUndefined();
    expect(t.developer_instructions).toContain("Ask a scout via");
    expect(t.developer_instructions).toContain("- Don't start other agents.");
    expect(t.developer_instructions).not.toContain("web");
    expect(out.warnings.some((w) => w.kind === "mode")).toBe(true);
  });

  it("omits model when none is requested and escapes TOML specials", () => {
    const out = gen("codex", spec("x", { instructions: 'Path C:\\dir and """quotes"""\n' }), {});
    const t = parseToml(out.content) as Record<string, any>;
    expect(t.model).toBeUndefined();
    expect(t.developer_instructions).toContain('Path C:\\dir and """quotes"""');
    expect(out.content).toContain("# binding: generate; model: none; effort: default");
  });

  it("per-harness ids differ: the same agent resolves per harness (R-PH-6)", () => {
    const a = spec("author", { spawn: ["scout"] });
    expect(gen("opencode", a, { scout: ex("explore") }).content).toContain("`explore`");
    expect(gen("codex", a, { scout: ex("explorer") }).content).toContain("`explorer`");
  });

  it("is deterministic", () => {
    const a = spec("author", { spawn: ["scout"] });
    expect(gen("codex", a, {}).content).toBe(gen("codex", a, {}).content);
    expect(gen("opencode", a, {}).content).toBe(gen("opencode", a, {}).content);
  });
});

describe("agent header", () => {
  it("records model and effort", () => {
    const o = gen("opencode", spec("a"), {}, { concrete: "gh/claude-sonnet-5.5#high", effort: "high" });
    expect(parseAgentHeader(o.content)).toMatchObject({ binding: "generate", model: "gh/claude-sonnet-5.5", effort: "high" });
    const c = gen("codex", spec("a"), {}, { requested: ["m1", "m2"], effort: "low" });
    expect(parseAgentHeader(c.content)).toMatchObject({ model: "m1", effort: "low" });
  });
  it("round-trips and verifies the hash for both harnesses", () => {
    for (const h of ["opencode", "codex"] as const) {
      const out = gen(h, spec("author"), {});
      const p = parseAgentHeader(out.content)!;
      expect(p).toMatchObject({ source: "https://github.com/morovid/skills", version: "v1.0.0", agent: "author", binding: "generate", model: "none", effort: "default" });
      expect(p.hash).toMatch(/^sha256-[0-9a-f]{64}$/);
      expect(verifyAgentHash(out.content)).toBe(true);
      expect(verifyAgentHash(out.content + "x")).toBe(false);
      expect(verifyAgentHash(out.content.replace("You are author", "You are autho"))).toBe(false);
    }
  });
  it("parses ssh sources with @ and rejects files without a header", () => {
    const content = "# generated by skillpack from git@github.com:a/b@v1 src/agents/x/ — do not edit; change with `skillpack configure`\n# binding: generate; model: none; effort: default\n# hash: sha256-" + "0".repeat(64) + "\nrest";
    expect(parseAgentHeader(content)).toMatchObject({ source: "git@github.com:a/b", version: "v1", agent: "x", bodyStart: content.length - 4 });
    expect(parseAgentHeader("name = 'x'\n")).toBeNull();
    expect(verifyAgentHash("plain")).toBe(false);
  });
});
