import { describe, expect, it } from "vitest";
import { deriveScope, resolvePackRef, PackRefError } from "../../src/core/project/pack-ref.js";
import type { Lock, SelectionConfig } from "../../src/core/project/index.js";

const SHA = "a".repeat(40);
const H = "sha256-" + "b".repeat(64);
const A = "https://github.com/acme/skills";
const B = "https://github.com/acme/other";

const cfg = (packs: Record<string, Partial<SelectionConfig["packs"][string]>>): SelectionConfig => ({
  raw: {},
  packs: Object.fromEntries(
    Object.entries(packs).map(([k, v]) => [k, { version: "^1", harnesses: ["opencode"], skills: "*", agents: {}, ...v }]),
  ),
});
const lockOf = (packs: Record<string, string[]>): Lock => ({
  cli: "0.1.0",
  packs: Object.fromEntries(
    Object.entries(packs).map(([k, folders]) => [k, { ref: null, commit: SHA, skills: Object.fromEntries(folders.map((f) => [`.agents/skills/${f}`, H])) }]),
  ),
});
const dir = "/nonexistent-project";
const scopesOf = (config: SelectionConfig, lock: Lock | null) => (key: string) => deriveScope(dir, config, lock, key);

describe("deriveScope", () => {
  it("uses an --as override exactly", () => {
    const c = cfg({ [A]: { scope: "mine" } });
    expect(deriveScope(dir, c, lockOf({ [A]: ["mine-a", "mine-b"] }), A)).toEqual({ best: "mine", exact: true, candidates: ["mine"] });
  });
  it("derives an exact scope from a listed skill name, including _ names", () => {
    const c = cfg({ [A]: { skills: ["plan_code"] } });
    expect(deriveScope(dir, c, lockOf({ [A]: ["my-pack-plan-code"] }), A)).toEqual({ best: "my-pack", exact: true, candidates: ["my-pack"] });
  });
  it("single skill folder (skills: *): first segment is the best guess", () => {
    const d = deriveScope(dir, cfg({ [A]: {} }), lockOf({ [A]: ["tpack-review"] }), A);
    expect(d).toMatchObject({ best: "tpack", exact: false });
    expect(d.candidates).toEqual(["tpack"]);
    expect(deriveScope(dir, cfg({ [A]: {} }), lockOf({ [A]: ["my-pack-review"] }), A).candidates).toEqual(["my", "my-pack"]);
  });
  it("several folders: common prefix at a dash boundary", () => {
    const d = deriveScope(dir, cfg({ [A]: {} }), lockOf({ [A]: ["tpack-plan-code", "tpack-review"] }), A);
    expect(d).toEqual({ best: "tpack", exact: false, candidates: ["tpack"] });
  });
  it("scope containing a dash keeps every boundary as a candidate", () => {
    const d = deriveScope(dir, cfg({ [A]: {} }), lockOf({ [A]: ["my-pack-plan-a", "my-pack-plan-b"] }), A);
    expect(d.best).toBe("my-pack-plan");
    expect(d.candidates).toEqual(["my", "my-pack", "my-pack-plan"]);
    expect(deriveScope(dir, cfg({ [A]: {} }), lockOf({ [A]: ["my-pack-review", "my-pack-ship"] }), A).best).toBe("my-pack");
  });
  it("a common prefix that stops mid-word is cut at the last dash", () => {
    expect(deriveScope(dir, cfg({ [A]: {} }), lockOf({ [A]: ["acme-plan", "acme-planning"] }), A).best).toBe("acme");
  });
  it("knows nothing without a lock entry or shared prefix", () => {
    expect(deriveScope(dir, cfg({ [A]: {} }), null, A)).toEqual({ best: null, exact: false, candidates: [] });
    expect(deriveScope(dir, cfg({ [A]: {} }), lockOf({ [A]: ["alpha-x", "beta-y"] }), A).best).toBeNull();
  });
});

describe("resolvePackRef", () => {
  const c = cfg({ [A]: {}, [B]: { scope: "extra" } });
  const l = lockOf({ [A]: ["tpack-plan-code", "tpack-review"], [B]: ["extra-x"] });
  const so = scopesOf(c, l);

  it("resolves by source in any accepted form", () => {
    expect(resolvePackRef(c, "acme/skills", so)).toBe(A);
    expect(resolvePackRef(c, A, so)).toBe(A);
    expect(resolvePackRef(c, "https://github.com/acme/skills.git", so)).toBe(A);
    expect(resolvePackRef(c, "acme/other", so)).toBe(B);
  });
  it("resolves by scope: derived and --as override", () => {
    expect(resolvePackRef(c, "tpack", so)).toBe(A);
    expect(resolvePackRef(c, "extra", so)).toBe(B);
  });
  it("lists the configured packs for an unknown ref", () => {
    expect(() => resolvePackRef(c, "nope", so)).toThrow(PackRefError);
    expect(() => resolvePackRef(c, "nope", so)).toThrow(/Configured packs: .*skills \(tpack\).*other \(extra\)/);
    expect(() => resolvePackRef(cfg({}), "nope", so)).toThrow(/no packs are configured/);
  });
  it("reports ambiguity", () => {
    const c2 = cfg({ [A]: {}, [B]: {} });
    const l2 = lockOf({ [A]: ["tpack-one", "tpack-two"], [B]: ["tpack-three", "tpack-four"] });
    expect(() => resolvePackRef(c2, "tpack", scopesOf(c2, l2))).toThrow(/matches more than one pack/);
    expect(resolvePackRef(c2, "acme/other", scopesOf(c2, l2))).toBe(B);
  });
  it("a scope ref doesn't match a pack by accident of its repo name", () => {
    expect(() => resolvePackRef(c, "skills", so)).toThrow(PackRefError);
  });
});
