import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { validatePack } from "../src/commands/validate/validate-pack.js";

const fixture = (n: string): string => join(import.meta.dirname, "fixtures", "packs", n);
const codes = (n: string, cliVersion = "0.1.0"): string[] =>
  validatePack(fixture(n), { cliVersion }).diagnostics.items.map((d) => d.code);

async function cli(args: string[]) {
  let out = "";
  let err = "";
  const code = await main(args, { cwd: process.cwd(), stdout: (t) => (out += t), stderr: (t) => (err += t), color: false });
  return { code, out, err };
}

describe("validatePack", () => {
  it("accepts the valid pack", () => {
    const r = validatePack(fixture("valid"), { cliVersion: "0.1.0" });
    expect(r.diagnostics.items).toEqual([]);
    expect([r.name, r.skills, r.agents]).toEqual(["tpack", 2, 3]);
  });
  it("rejects a CLI outside the pack's range", () => {
    expect(codes("valid", "0.0.1")).toEqual(["manifest-cli-version"]);
  });
  it("detects spawn cycles", () => {
    const d = validatePack(fixture("spawn-cycle"), { cliVersion: "0.1.0" }).diagnostics.items;
    expect(d.map((x) => x.code)).toEqual(["spawn-cycle"]);
    expect(d[0]?.message).toMatch(/a -> b -> c -> a/);
  });
  it("detects unknown placeholders with lines", () => {
    const d = validatePack(fixture("unknown-placeholder"), { cliVersion: "0.1.0" }).diagnostics.items;
    expect(d.map((x) => x.code)).toEqual([
      "placeholder-unknown",
      "placeholder-unknown",
      "placeholder-agent",
      "placeholder-skill",
      "placeholder-unclosed",
    ]);
    expect(d.slice(0, 4).every((x) => x.line === 10 && x.file === "src/skills/one/SKILL.md")).toBe(true);
    expect(d[4]).toMatchObject({ line: 12, file: "src/skills/one/SKILL.md" });
  });
  it("detects kebab name collisions", () => {
    expect(codes("name-collision")).toEqual(["skill-name-collision"]);
  });
  it("reports manifest problems", () => {
    const c = codes("bad-manifest");
    expect(c).toEqual(["manifest-schema", "manifest-schema"]);
  });
  it("reports unclosed placeholders in fallback and description", () => {
    expect(codes("unclosed-fallback").sort()).toEqual(["agent-fallback-placeholder", "placeholder-unclosed"]);
  });
  it("limits only the scoped name length", () => {
    const dir = mkdtempSync(join(tmpdir(), "sp-"));
    const name = "a".repeat(60);
    const make = (scope: string) => {
      mkdirSync(join(dir, "src/agents", name), { recursive: true });
      writeFileSync(join(dir, "skillpack.pack.json"), JSON.stringify({ name: scope }));
      writeFileSync(join(dir, "src/agents", name, "manifest.json"), JSON.stringify({ description: "d", fallback: "f" }));
      writeFileSync(join(dir, "src/agents", name, "instructions.md"), "Hi");
      return validatePack(dir, { cliVersion: "0.1.0" }).diagnostics.items.map((d) => d.code);
    };
    expect(make("ab")).toEqual([]);
    expect(make("abcdefghij")).toEqual(["agent-name-length"]);
  });
  it("reports a missing manifest and empty pack", () => {
    expect(codes("does-not-exist")).toEqual(["manifest-missing", "pack-empty"]);
  });
});

describe("cli", () => {
  it("exits 0 for a valid pack", async () => {
    const r = await cli(["validate", fixture("valid")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('✔ pack "tpack" is valid (2 skills, 3 agents)');
  });
  it("exits 1 for invalid packs", async () => {
    for (const n of ["spawn-cycle", "unknown-placeholder", "name-collision", "bad-manifest"]) {
      const r = await cli(["validate", fixture(n)]);
      expect(r.code, n).toBe(1);
      expect(r.out).toMatch(/✖ \d+ errors?/);
    }
  });
  it("prints JSON", async () => {
    const r = await cli(["validate", "--json", fixture("name-collision")]);
    expect(JSON.parse(r.out).diagnostics[0].code).toBe("skill-name-collision");
  });
  it("--strict turns warnings into failures", async () => {
    const dir = fixture("valid");
    expect((await cli(["validate", dir])).code).toBe(0);
    const r = await cli(["validate", "--strict", join(fixture("valid"), "src", "skills")]);
    expect(r.code).toBe(1);
  });
  it("exits 2 on usage errors", async () => {
    expect((await cli(["validate", "--nope"])).code).toBe(2);
    const unknown = await cli(["frobnicate"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("unknown command");
  });
  it("prints help and version", async () => {
    expect((await cli(["validate", "--help"])).out).toContain("Usage: skillpack validate");
    expect((await cli(["help", "validate"])).code).toBe(0);
    expect((await cli(["--version"])).out).toMatch(/^\d+\.\d+\.\d+/);
  });
});
