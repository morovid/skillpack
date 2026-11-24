import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replaceFolder, replaceFolders } from "../../src/core/fs/atomic.js";
import { diffFolders } from "../../src/core/fs/diff.js";
import { hashFolder, hashFiles } from "../../src/core/hash.js";
import { readTree } from "../../src/core/fs/tree.js";

const f = (path: string, s: string, mode = 0o644) => ({ path, content: Buffer.from(s), mode });
const tmp = () => mkdtempSync(join(tmpdir(), "sp-fs-"));

describe("replaceFolder", () => {
  it("replaces content, drops stale files, sets modes, leaves no temp dirs", () => {
    const root = tmp();
    const dir = join(root, "skills");
    mkdirSync(join(dir, "old"), { recursive: true });
    writeFileSync(join(dir, "old", "x.md"), "old");
    replaceFolder(dir, [f("a/SKILL.md", "new"), f("a/run.sh", "#!/bin/sh", 0o755)]);
    expect(readdirSync(dir)).toEqual(["a"]);
    expect(statSync(join(dir, "a/run.sh")).mode & 0o111).not.toBe(0);
    expect(readdirSync(root)).toEqual(["skills"]);
    expect(hashFolder(dir)).toBe(hashFiles([f("a/SKILL.md", "new"), f("a/run.sh", "#!/bin/sh")]));
  });
  it("leaves the original untouched on failure", () => {
    const root = tmp();
    const dir = join(root, "skills");
    mkdirSync(dir);
    writeFileSync(join(dir, "keep.md"), "keep");
    expect(() => replaceFolder(dir, [f("a", "file"), f("a/b", "conflict")])).toThrow();
    expect(readFileSync(join(dir, "keep.md"), "utf8")).toBe("keep");
    expect(readdirSync(root)).toEqual(["skills"]);
  });
  it("rolls back earlier targets when a later one fails, and handles several targets", () => {
    const root = tmp();
    const one = join(root, "one");
    mkdirSync(one);
    writeFileSync(join(one, "k"), "k");
    expect(() => replaceFolders([{ dir: one, files: [f("n", "n")] }, { dir: join(root, "two"), files: [f("a", "x"), f("a/b", "y")] }])).toThrow();
    expect(readdirSync(one)).toEqual(["k"]);
    replaceFolders([{ dir: one, files: [f("n", "n")] }, { dir: join(root, "two"), files: [f("m", "m")] }]);
    expect(existsSync(join(root, "two/m"))).toBe(true);
    replaceFolder(one, []);
    expect(existsSync(one)).toBe(false);
  });
});

describe("diffFolders", () => {
  it("classifies folders and files, ignoring CRLF", () => {
    const d = diffFolders(
      [f("a/SKILL.md", "x\n"), f("b/SKILL.md", "y"), f("c/SKILL.md", "z"), f("c/n.md", "n")],
      [f("a/SKILL.md", "x\r\n"), f("b/SKILL.md", "CHANGED"), f("c/SKILL.md", "z"), f("c/extra.md", "e"), f("gone/SKILL.md", "g")],
    );
    expect(d.unchanged).toEqual(["a"]);
    expect(d.folders.map((x) => [x.name, x.status])).toEqual([["b", "changed"], ["c", "changed"], ["gone", "removed"]]);
    expect(d.folders[1]!.files).toEqual([{ path: "c/extra.md", status: "removed" }, { path: "c/n.md", status: "added" }]);
    expect(diffFolders([f("n/SKILL.md", "x")], []).folders[0]!.status).toBe("added");
  });
  it("detects an executable bit change", () => {
    expect(diffFolders([f("a/r.sh", "x", 0o755)], [f("a/r.sh", "x")]).folders).toHaveLength(1);
  });
  it("readTree skips .DS_Store", () => {
    const d = tmp();
    writeFileSync(join(d, ".DS_Store"), "x");
    writeFileSync(join(d, "a.md"), "a");
    expect(readTree(d).map((x) => x.path)).toEqual(["a.md"]);
  });
});
