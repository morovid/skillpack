import { describe, expect, it } from "vitest";
import { schemaVersion, validateAgainst, type SchemaName } from "../../src/core/schema/index.js";

const U = (f: string) => `https://skillpack.morovid.com/schemas/v1/${f}.json`;

const valid: Record<SchemaName, unknown> = {
  pack: { $schema: U("pack"), name: "morovid", cli: ">=0.1.0", harnesses: ["opencode"] },
  agent: {
    $schema: U("agent"),
    description: "d",
    fallback: "f",
    model: { name: ["a-1", "b-2"], effort: "high" },
    spawn: ["x"],
    capabilities: { edit: { allow: ["*.md"] }, shell: false, mcp: ["srv"] },
  },
  config: { $schema: U("config"), packs: {} },
  models: { $schema: U("models"), packs: {} },
  lock: { $schema: U("lock"), cli: "0.1.0", packs: {} },
};

const msgs = (n: SchemaName, d: unknown) => validateAgainst(n, d).map((i) => `${i.path} ${i.message}`);

describe("validateAgainst", () => {
  it("accepts valid documents", () => {
    for (const n of ["pack", "agent", "config", "models", "lock"] as const) expect(validateAgainst(n, valid[n])).toEqual([]);
  });

  it("compiles every schema and rejects non-objects", () => {
    for (const n of ["pack", "agent", "config", "models", "lock"] as const) {
      const r = validateAgainst(n, 5);
      expect(r[0]).toMatchObject({ path: "", message: expect.stringContaining("object") });
    }
  });

  it("pack: required, pattern, additionalProperties, length, enum", () => {
    expect(msgs("pack", {})).toEqual([' missing required property "name"']);
    const m = msgs("pack", { name: "Bad", extra: 1, harnesses: ["vim"], description: "" });
    expect(m).toContain("/name must match pattern ^[a-z0-9]+([-_][a-z0-9]+)*$");
    expect(m).toContain('/extra unexpected property "extra"');
    expect(m).toContain('/harnesses/0 must be one of "opencode", "codex"');
    expect(m).toContain("/description must not be empty");
    expect(msgs("pack", { name: "x".repeat(25) })[0]).toMatch(/^\/name must NOT have more than 24/);
  });

  it("agent: spawn items, uniqueness, and no standalone name length limit", () => {
    const base = { description: "d", fallback: "f" };
    expect(msgs("agent", { ...base, spawn: ["Bad"] })[0]).toMatch(/^\/spawn\/0 must match pattern/);
    expect(msgs("agent", { ...base, spawn: ["a", "a"] })[0]).toMatch(/^\/spawn must NOT have duplicate/);
    expect(validateAgainst("agent", { ...base, spawn: ["a".repeat(80)] })).toEqual([]);
  });

  it("agent: oneOf errors are concise", () => {
    const base = { description: "d", fallback: "f" };
    expect(msgs("agent", { ...base, model: 5 })).toEqual(["/model must be string or object"]);
    expect(msgs("agent", { ...base, model: {} })).toEqual(['/model missing required property "name"']);
    expect(msgs("agent", { ...base, model: { name: "x", effort: "huge" } })).toEqual([
      '/model/effort must be one of "low", "medium", "high", "xhigh", "max"',
    ]);
    expect(msgs("agent", { ...base, capabilities: { mcp: "x" } })).toEqual(["/capabilities/mcp must be boolean or array"]);
    expect(msgs("agent", { ...base, capabilities: { edit: {} } })).toEqual([
      "/capabilities/edit must NOT have fewer than 1 properties",
    ]);
  });

  it("config: propertyNames and nested pack errors", () => {
    expect(msgs("config", { packs: { "not a source": {} } }).join("\n")).toContain("/packs/not a source");
    expect(msgs("config", {})).toEqual([' missing required property "packs"']);
  });

  it("models and lock: wrong $schema and unknown keys", () => {
    expect(msgs("models", { $schema: "https://example.com/x.json", packs: {} })[0]).toMatch(/^\/\$schema must match pattern/);
    expect(msgs("lock", { cli: "0.1.0", packs: {}, bogus: 1 })).toEqual(['/bogus unexpected property "bogus"']);
  });
});

describe("schemaVersion", () => {
  it("defaults to 1", () => {
    expect(schemaVersion({}, "f")).toEqual({ version: 1 });
    expect(schemaVersion({ $schema: U("pack") }, "f")).toEqual({ version: 1 });
  });
  it("rejects unsupported versions", () => {
    expect(schemaVersion({ $schema: "https://skillpack.morovid.com/schemas/v2/pack.json" }, "f")).toHaveProperty("error");
  });
});
