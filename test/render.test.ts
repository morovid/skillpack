import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTree } from "../src/core/fs/tree.js";
import { main } from "../src/main.js";

const packs = join(import.meta.dirname, "fixtures", "packs");
const golden = join(import.meta.dirname, "fixtures", "render", "valid");
const valid = join(packs, "valid");

async function cli(args: string[]) {
  let out = "";
  let err = "";
  const code = await main(args, { cwd: process.cwd(), stdout: (t) => (out += t), stderr: (t) => (err += t), color: false });
  return { code, out, err };
}
const tmp = () => join(mkdtempSync(join(tmpdir(), "sp-render-")), "out");
const flags = ["-a", "opencode,codex", "--bind", "scout.opencode=existing:explore"];

describe("render", () => {
  it("previews without writing", async () => {
    const r = await cli(["render", valid, ...flags]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(".agents/skills/tpack-review/SKILL.md");
    expect(r.out).toContain(".opencode/agents/tpack-author.md");
    expect(r.out).toContain(".codex/agents/tpack-scout.toml");
    expect(r.out).toMatch(/scout\s+existing:explore\s+generate \(tpack-scout\)/);
    expect(r.out).not.toContain(".opencode/agents/tpack-scout.md");
    expect(r.out).toContain("unenforced  author (Codex): 6 restrictions not enforced (listed in the agent's instructions)");
    expect(r.out).not.toContain("Edit only files matching");
    expect(r.out).toMatch(/mode\s+code_lead \(Codex\): mode: primary/);
    expect(r.out).toContain("preview");
  });

  it("--verbose lists every restriction; --json always does", async () => {
    const v = await cli(["render", valid, "--verbose"]);
    expect(v.out).toContain("Edit only files matching specs/*.");
    expect(v.out).not.toContain("restrictions not enforced");
    const j = JSON.parse((await cli(["render", valid, "--json"])).out);
    expect(j.warnings.filter((w: { kind: string }) => w.kind === "unenforced").length).toBeGreaterThan(5);
  });

  it("--out writes the golden tree byte for byte (modes included)", async () => {
    const out = tmp();
    const r = await cli(["render", valid, ...flags, "--out", out]);
    expect(r.code).toBe(0);
    expect(readTree(out)).toEqual(readTree(golden));
  });

  it("golden skills and agents are fully resolved", () => {
    const text = readTree(golden).filter((f) => /\.(md|toml)$/.test(f.path)).map((f) => f.content.toString()).join("\n");
    expect(text).not.toMatch(/\{\{(agent|skill|scope)/);
    expect(text).not.toContain("internal");
    expect(text).toContain("`explore` (Codex: `tpack-scout`)");
  });

  it("refuses a non-empty --out and never touches the pack", async () => {
    const out = tmp();
    await cli(["render", valid, "--out", out]);
    const r = await cli(["render", valid, "--out", out]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not empty");
    expect(existsSync(join(valid, ".agents"))).toBe(false);
  });

  it("--agent and --bind change the output", async () => {
    const r = await cli(["render", valid, "--agent", "author", "--json"]);
    const j = JSON.parse(r.out);
    expect(j.bindings.scout.opencode).toEqual({ binding: "none", id: null });
    expect(j.bindings.author.codex).toEqual({ binding: "generate", id: "tpack-author" });
    expect(j.files.map((f: { path: string }) => f.path).some((p: string) => p.includes("scout"))).toBe(false);
    expect(j.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const skill = readTree(join(valid, "src/skills/review")).length; // sanity: fixture untouched
    expect(skill).toBeGreaterThan(0);
  });

  it("--as changes the scope", async () => {
    const j = JSON.parse((await cli(["render", valid, "--as", "other_scope", "--json"])).out);
    expect(j.scope).toBe("other_scope");
    expect(j.files.some((f: { path: string }) => f.path === ".agents/skills/other-scope-review/SKILL.md")).toBe(true);
  });

  it("restricts harnesses", async () => {
    const j = JSON.parse((await cli(["render", valid, "-a", "codex", "-a", "codex", "--json"])).out);
    expect(j.harnesses).toEqual(["codex"]);
    expect(j.files.some((f: { path: string }) => f.path.startsWith(".opencode/"))).toBe(false);
  });

  it("exits 2 on usage errors", async () => {
    for (const args of [
      ["-a", "vim"],
      ["--bind", "scout=existing:explore"],
      ["--bind", "scout.codex=existing:nope"],
      ["--bind", "ghost=none"],
      ["--agent", "ghost"],
      ["--as", "Bad Scope"],
      ["--as", "x".repeat(30)],
      ["--nope"],
    ]) {
      expect((await cli(["render", valid, ...args])).code, args.join(" ")).toBe(2);
    }
  });

  it("rejects harnesses the manifest doesn't support", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "sp-render-")), "p");
    const { cpSync, writeFileSync } = await import("node:fs");
    cpSync(valid, dir, { recursive: true });
    writeFileSync(join(dir, "skillpack.pack.json"), JSON.stringify({ name: "tpack", harnesses: ["opencode"] }));
    expect((await cli(["render", dir, "-a", "codex"])).code).toBe(2);
    expect((await cli(["render", dir, "-a", "*", "--json"])).out).toContain('"harnesses": [\n    "opencode"\n  ]');
  });

  it("exits 1 and renders nothing for invalid packs", async () => {
    const out = tmp();
    const r = await cli(["render", join(packs, "spawn-cycle"), "--out", out]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("nothing rendered");
    expect(existsSync(out)).toBe(false);
  });
});
