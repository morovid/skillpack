import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTree } from "../src/core/fs/tree.js";
import { main } from "../src/main.js";

const packs = join(import.meta.dirname, "fixtures", "packs");
const golden = join(import.meta.dirname, "fixtures", "build", "valid", "skills");

async function cli(args: string[]) {
  let out = "";
  let err = "";
  const code = await main(args, { cwd: process.cwd(), stdout: (t) => (out += t), stderr: (t) => (err += t), color: false });
  return { code, out, err };
}
const copyPack = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "sp-build-"));
  cpSync(join(packs, name), dir, { recursive: true });
  return dir;
};

describe("build", () => {
  it("matches the golden plain build byte for byte (including modes)", async () => {
    const dir = copyPack("valid");
    const r = await cli(["build", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✔ built 2 skills into skills/");
    expect(readTree(join(dir, "skills"))).toEqual(readTree(golden));
  });

  it("golden content has no leftover placeholders or metadata.internal", () => {
    const all = readTree(golden).filter((f) => /\.(md|txt)$/.test(f.path)).map((f) => f.content.toString()).join("\n");
    expect(all).not.toMatch(/\{\{(agent|skill|scope)/);
    expect(all).not.toContain("internal");
    expect(all).toContain("Literal {{ ok.");
    expect(all).toContain("../plan-code/SKILL.md#steps");
  });

  it("a second build is a no-op and --check passes", async () => {
    const dir = copyPack("valid");
    await cli(["build", dir]);
    const before = statMtimes(dir);
    await new Promise((r) => setTimeout(r, 20));
    const again = await cli(["build", dir]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("nothing written");
    expect(statMtimes(dir)).toEqual(before);
    const c = await cli(["build", "--check", dir]);
    expect(c.code).toBe(0);
    expect(c.out).toContain("✔ skills/ is up to date");
  });

  it("--check fails after editing, adding or removing a file, and never writes", async () => {
    const dir = copyPack("valid");
    await cli(["build", dir]);
    const skill = join(dir, "skills", "review");

    writeFileSync(join(skill, "SKILL.md"), readFileSync(join(skill, "SKILL.md"), "utf8") + "edit\n");
    let r = await cli(["build", "--check", dir]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("review/SKILL.md (differs)");
    expect(r.out).toContain("run skillpack build");

    await cli(["build", dir]);
    writeFileSync(join(skill, "extra.md"), "x");
    r = await cli(["build", "--check", dir]);
    expect([r.code, r.out.includes("review/extra.md (extra)")]).toEqual([1, true]);
    expect(existsSync(join(skill, "extra.md"))).toBe(true);

    await cli(["build", dir]);
    expect(existsSync(join(skill, "extra.md"))).toBe(false);
    unlinkSync(join(skill, "assets", "pixel.png"));
    r = await cli(["build", "--check", dir]);
    expect([r.code, r.out.includes("review/assets/pixel.png (missing)")]).toEqual([1, true]);

    rmSync(join(dir, "skills"), { recursive: true });
    const json = JSON.parse((await cli(["build", "--check", "--json", dir])).out);
    expect(json).toMatchObject({ ok: false, mode: "check", upToDate: false });
    expect(existsSync(join(dir, "skills"))).toBe(false);
  });

  it("--check ignores CRLF differences from autocrlf", async () => {
    const dir = copyPack("valid");
    await cli(["build", dir]);
    const p = join(dir, "skills", "plan-code", "references", "notes.md");
    writeFileSync(p, readFileSync(p, "utf8").replaceAll("\n", "\r\n"));
    expect((await cli(["build", "--check", dir])).code).toBe(0);
  });

  it("removes stale skill folders", async () => {
    const dir = copyPack("valid");
    await cli(["build", dir]);
    cpSync(join(dir, "skills", "review"), join(dir, "skills", "stale"), { recursive: true });
    const r = await cli(["build", dir]);
    expect(r.out).toContain("- stale");
    expect(existsSync(join(dir, "skills", "stale"))).toBe(false);
  });

  it("exits 1 and writes nothing for invalid packs", async () => {
    for (const n of ["spawn-cycle", "unknown-placeholder", "name-collision", "bad-manifest", "unclosed-fallback"]) {
      const dir = copyPack(n);
      const r = await cli(["build", dir]);
      expect(r.code, n).toBe(1);
      expect(r.out).toContain("nothing built");
      expect(existsSync(join(dir, "skills")), n).toBe(false);
      expect((await cli(["build", "--check", dir])).code, n).toBe(1);
    }
  });

  it("exits 2 on usage errors", async () => {
    expect((await cli(["build", "--nope"])).code).toBe(2);
    expect((await cli(["build", "a", "b"])).code).toBe(2);
  });
});

function statMtimes(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of readTree(join(dir, "skills"))) out[f.path] = statSync(join(dir, "skills", f.path)).mtimeMs;
  return out;
}
