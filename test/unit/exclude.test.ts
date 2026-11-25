import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCK_END, BLOCK_START, ExcludeBlockError, parseExcludeBlock, updateExcludeBlock } from "../../src/core/project/exclude.js";
import { findGitExcludePath, planExcludeUpdate } from "../../src/core/project/git-exclude.js";

describe("updateExcludeBlock", () => {
  it("creates the block at the end, sorted, with leading slashes", () => {
    expect(updateExcludeBlock("", { add: ["skillpack.models.json", ".codex/agents/b.toml", "./.codex/agents/a.toml"] })).toBe(
      `${BLOCK_START}\n/.codex/agents/a.toml\n/.codex/agents/b.toml\n/skillpack.models.json\n${BLOCK_END}\n`,
    );
  });
  it("keeps user lines, adds a newline when missing, and doesn't touch lines around the block", () => {
    const before = `node_modules\n*.log`;
    const after = updateExcludeBlock(before, { add: ["a"] });
    expect(after).toBe(`node_modules\n*.log\n${BLOCK_START}\n/a\n${BLOCK_END}\n`);
    const again = updateExcludeBlock(after + "# mine\n", { add: ["b", "a"] });
    expect(again).toBe(`node_modules\n*.log\n${BLOCK_START}\n/a\n/b\n${BLOCK_END}\n# mine\n`);
  });
  it("dedupes, and removes only listed paths", () => {
    const t = updateExcludeBlock("x\n", { add: ["a", "b", "a", "/b"] });
    expect(parseExcludeBlock(t).paths).toEqual(["/a", "/b"]);
    expect(parseExcludeBlock(updateExcludeBlock(t, { remove: ["a", "zzz"] })).paths).toEqual(["/b"]);
  });
  it("removes the block entirely when empty and leaves other text byte-identical", () => {
    const t = updateExcludeBlock("keep1\nkeep2\n", { add: ["a"] });
    expect(updateExcludeBlock(t, { remove: ["a"] })).toBe("keep1\nkeep2\n");
    expect(updateExcludeBlock(updateExcludeBlock("", { add: ["a"] }), { remove: ["a"] })).toBe("");
  });
  it("is a no-op without a block and nothing to add", () => {
    expect(updateExcludeBlock("abc", { remove: ["a"] })).toBe("abc");
    expect(updateExcludeBlock("abc", {})).toBe("abc");
  });
  it("is idempotent and keeps CRLF files CRLF", () => {
    const once = updateExcludeBlock("a\r\n", { add: ["p"] });
    expect(once).toBe(`a\r\n${BLOCK_START}\r\n/p\r\n${BLOCK_END}\r\n`);
    expect(updateExcludeBlock(once, { add: ["p"] })).toBe(once);
  });
  it("set replaces the block's paths exactly and leaves the rest alone", () => {
    const t = updateExcludeBlock("a\n", { add: ["x", "y"] });
    const set = updateExcludeBlock(t + "b\n", { set: ["/y", "z"] });
    expect(set).toBe(`a\n${BLOCK_START}\n/y\n/z\n${BLOCK_END}\nb\n`);
    expect(updateExcludeBlock(set, { set: [] })).toBe("a\nb\n");
    expect(updateExcludeBlock("a\n", { set: [] })).toBe("a\n");
  });
  it("throws on an unterminated block", () => {
    expect(() => updateExcludeBlock(`${BLOCK_START}\n/a\n`, { add: ["b"] })).toThrow(ExcludeBlockError);
  });
});

describe("git exclude lookup", () => {
  const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "sp-git-")));
  it("finds info/exclude in a repo and plans an update", async () => {
    const dir = tmp();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    mkdirSync(join(dir, "sub"));
    const p = await findGitExcludePath(join(dir, "sub"));
    expect(p).toBe(join(dir, ".git", "info", "exclude"));
    const op = await planExcludeUpdate(dir, { add: ["skillpack.models.json"] });
    expect(op).toMatchObject({ type: "write-file", path: p, label: "exclude" });
    expect((op as { content: string }).content).toContain("/skillpack.models.json");
  });
  it("returns null / outsideRepo outside a repository", async () => {
    const dir = tmp();
    expect(await findGitExcludePath(dir)).toBeNull();
    expect(await planExcludeUpdate(dir, { add: ["x"] })).toEqual({ outsideRepo: true });
  });
});
