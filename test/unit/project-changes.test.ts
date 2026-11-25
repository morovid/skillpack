import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashFiles, hashFolder } from "../../src/core/hash.js";
import { buildAgentHeader } from "../../src/core/agents/header.js";
import type { TreeFile } from "../../src/core/fs/tree.js";
import {
  applyChanges, classifyAgentFile, classifySkillFolder, describeChanges, emptyLock, findOwnedAgentFiles,
  formatChangeDescriptions, planChanges, type DesiredPack, type Lock, type ProjectOp,
} from "../../src/core/project/index.js";

const SRC = "https://github.com/acme/skills";
const SHA = "a".repeat(40);
const f = (path: string, s: string, mode = 0o644): TreeFile => ({ path, content: Buffer.from(s), mode });
const tmp = () => mkdtempSync(join(tmpdir(), "sp-chg-"));
const put = (dir: string, path: string, content: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};
const SK = ".agents/skills/acme-one";

function agentFile(source: string, id = "acme-a", body = "body\n") {
  const rest = `description: d\n---\n${body}`;
  return `---\n${buildAgentHeader({ source, version: "v1", agent: "a", binding: "generate", model: "none", effort: "default" }, rest)}${rest}`;
}

function lockWith(skills: Record<string, TreeFile[]>, source = SRC): Lock {
  const l = emptyLock("0.1.0");
  l.packs[source] = { ref: "refs/tags/v1", commit: SHA, skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, hashFiles(v)])) };
  return l;
}

describe("classifySkillFolder", () => {
  it("absent, foreign, owned-clean, owned-edited (CRLF-insensitive)", () => {
    const dir = tmp();
    const files = [f("SKILL.md", "a\nb\n"), f("x.png", "bin")];
    const lock = lockWith({ [SK]: files });
    expect(classifySkillFolder(dir, SK, lock)).toEqual({ state: "absent", owner: SRC });
    put(dir, `${SK}/SKILL.md`, "a\r\nb\r\n"); // CRLF from autocrlf
    put(dir, `${SK}/x.png`, "bin");
    expect(classifySkillFolder(dir, SK, lock)).toEqual({ state: "owned-clean", owner: SRC });
    expect(hashFolder(join(dir, SK))).toBe(hashFiles(files));
    put(dir, `${SK}/SKILL.md`, "edited\n");
    expect(classifySkillFolder(dir, SK, lock).state).toBe("owned-edited");
    put(dir, ".agents/skills/other/SKILL.md", "x");
    expect(classifySkillFolder(dir, ".agents/skills/other", lock)).toEqual({ state: "foreign", owner: null });
    expect(classifySkillFolder(dir, SK, null).state).toBe("foreign");
  });
});

describe("classifyAgentFile / findOwnedAgentFiles", () => {
  it("classifies by header and hash", () => {
    const dir = tmp();
    const p = ".opencode/agents/acme-a.md";
    expect(classifyAgentFile(dir, p, SRC)).toBe("absent");
    put(dir, p, agentFile(SRC));
    expect(classifyAgentFile(dir, p, SRC)).toBe("owned-clean");
    expect(classifyAgentFile(dir, p, "https://other/pack")).toBe("foreign");
    put(dir, p, agentFile(SRC).replace("body", "hand edit"));
    expect(classifyAgentFile(dir, p, SRC)).toBe("owned-edited");
    put(dir, ".opencode/agents/mine.md", "---\nmy own agent\n---\n");
    expect(classifyAgentFile(dir, ".opencode/agents/mine.md", SRC)).toBe("foreign");
    put(dir, ".codex/agents/acme-b.toml", agentFile(SRC));
    put(dir, ".codex/agents/theirs.toml", agentFile("https://other/pack"));
    expect(findOwnedAgentFiles(dir, SRC)).toEqual([".opencode/agents/acme-a.md", ".codex/agents/acme-b.toml"]);
  });
});

const desired = (skills: Record<string, TreeFile[]> = {}, agents: Record<string, string> = {}): DesiredPack => ({
  source: SRC,
  skills: new Map(Object.entries(skills)),
  agents: new Map(Object.entries(agents)),
});
const types = (ops: ProjectOp[]) => ops.map((o) => `${o.type}:${o.path}`);

describe("planChanges: skills", () => {
  const want = [f("SKILL.md", "new\n")];
  const old = [f("SKILL.md", "old\n")];

  it("writes absent folders and skips identical ones", () => {
    const dir = tmp();
    expect(types(planChanges({ projectDir: dir, lock: null, desired: [desired({ [SK]: want })] }).ops)).toEqual([`write-skill-folder:${SK}`]);
    put(dir, `${SK}/SKILL.md`, "new\n");
    const lock = lockWith({ [SK]: want });
    const p = planChanges({ projectDir: dir, lock, desired: [desired({ [SK]: want })] });
    expect(p.ops).toEqual([]);
    expect(p.skillHashes[SRC]![SK]).toBe(hashFiles(want));
  });

  it("owned-clean with new content is rewritten; stale owned folders are deleted", () => {
    const dir = tmp();
    put(dir, `${SK}/SKILL.md`, "old\n");
    put(dir, ".agents/skills/acme-gone/SKILL.md", "g\n");
    const lock = lockWith({ [SK]: old, ".agents/skills/acme-gone": [f("SKILL.md", "g\n")] });
    const p = planChanges({ projectDir: dir, lock, desired: [desired({ [SK]: want })] });
    expect(types(p.ops)).toEqual([`delete-skill-folder:.agents/skills/acme-gone`, `write-skill-folder:${SK}`]);
    expect(p.blocked).toEqual([]);
  });

  it("foreign folders are blocked unless forced, and never deleted", () => {
    const dir = tmp();
    put(dir, `${SK}/SKILL.md`, "mine\n");
    const input = { projectDir: dir, lock: null, desired: [desired({ [SK]: want })] };
    const p = planChanges(input);
    expect(p.ops).toEqual([]);
    expect(p.blocked).toEqual([{ path: SK, kind: "skill", action: "write", reason: "foreign", pack: SRC }]);
    expect(types(planChanges(input, { force: true }).ops)).toEqual([`write-skill-folder:${SK}`]);
    expect(planChanges(input, { restoreEdited: true }).blocked).toHaveLength(1); // restore is not for foreign
    // removal never touches a foreign folder
    expect(planChanges({ projectDir: dir, lock: null, desired: [desired()] }).ops).toEqual([]);
  });

  it("edited folders: blocked, restored by restoreEdited or force; kept on delete without force", () => {
    const dir = tmp();
    put(dir, `${SK}/SKILL.md`, "hand edit\n");
    const lock = lockWith({ [SK]: old });
    const input = { projectDir: dir, lock, desired: [desired({ [SK]: want })] };
    expect(planChanges(input).blocked[0]).toMatchObject({ reason: "edited", action: "write" });
    expect(types(planChanges(input, { restoreEdited: true }).ops)).toEqual([`write-skill-folder:${SK}`]);
    expect(types(planChanges(input, { force: true }).ops)).toEqual([`write-skill-folder:${SK}`]);
    const remove = { projectDir: dir, lock, desired: [desired()] };
    expect(planChanges(remove).ops).toEqual([]);
    expect(planChanges(remove).blocked[0]).toMatchObject({ reason: "edited", action: "delete" });
    expect(types(planChanges(remove, { force: true }).ops)).toEqual([`delete-skill-folder:${SK}`]);
    // an edited folder that already equals the desired content needs nothing
    put(dir, `${SK}/SKILL.md`, "new\n");
    expect(planChanges(input).ops).toEqual([]);
    expect(planChanges(input).blocked).toEqual([]);
  });

  it("a folder owned by another pack is blocked", () => {
    const dir = tmp();
    put(dir, `${SK}/SKILL.md`, "old\n");
    const lock = lockWith({ [SK]: old }, "https://other/pack");
    const p = planChanges({ projectDir: dir, lock, desired: [desired({ [SK]: want })] });
    expect(p.blocked[0]).toMatchObject({ reason: "other-pack" });
    expect(types(planChanges({ projectDir: dir, lock, desired: [desired({ [SK]: want })] }, { force: true }).ops)).toEqual([`write-skill-folder:${SK}`]);
  });
});

describe("planChanges: agents", () => {
  const P = ".opencode/agents/acme-a.md";
  it("writes absent, rewrites clean when changed, skips identical, deletes stale owned files", () => {
    const dir = tmp();
    const v1 = agentFile(SRC);
    expect(types(planChanges({ projectDir: dir, lock: null, desired: [desired({}, { [P]: v1 })] }).ops)).toEqual([`write-file:${P}`]);
    put(dir, P, v1);
    expect(planChanges({ projectDir: dir, lock: null, desired: [desired({}, { [P]: v1 })] }).ops).toEqual([]);
    expect(types(planChanges({ projectDir: dir, lock: null, desired: [desired({}, { [P]: agentFile(SRC, "x", "new body\n") })] }).ops)).toEqual([`write-file:${P}`]);
    expect(types(planChanges({ projectDir: dir, lock: null, desired: [desired()] }).ops)).toEqual([`delete-file:${P}`]);
  });
  it("foreign and edited agent files are blocked; force overrides; restoreEdited doesn't apply", () => {
    const dir = tmp();
    put(dir, P, "mine");
    const input = { projectDir: dir, lock: null, desired: [desired({}, { [P]: agentFile(SRC) })] };
    expect(planChanges(input).blocked[0]).toMatchObject({ kind: "agent", reason: "foreign" });
    expect(planChanges(input, { restoreEdited: true }).blocked).toHaveLength(1);
    expect(types(planChanges(input, { force: true }).ops)).toEqual([`write-file:${P}`]);
    put(dir, P, agentFile(SRC).replace("body", "edited"));
    expect(planChanges(input).blocked[0]).toMatchObject({ reason: "edited" });
    const del = { projectDir: dir, lock: null, desired: [desired()] };
    expect(planChanges(del).blocked[0]).toMatchObject({ action: "delete", reason: "edited" });
    expect(types(planChanges(del, { force: true }).ops)).toEqual([`delete-file:${P}`]);
  });
});

describe("describeChanges / applyChanges", () => {
  it("describes create, change and delete and skips no-ops", () => {
    const dir = tmp();
    put(dir, "keep.txt", "same");
    put(dir, "old.txt", "x");
    put(dir, "chg.txt", "a");
    const ops: ProjectOp[] = [
      { type: "write-file", path: "keep.txt", content: "same" },
      { type: "write-file", path: "chg.txt", content: "b" },
      { type: "write-file", path: "new.txt", content: "n" },
      { type: "delete-file", path: "old.txt" },
      { type: "delete-file", path: "missing.txt" },
      { type: "write-skill-folder", path: SK, files: [f("SKILL.md", "x")] },
      { type: "write-json", path: "skillpack-lock.json", content: "{}\n", label: "lock" },
    ];
    const d = describeChanges(dir, ops);
    expect(d.map((x) => `${x.action} ${x.path} ${x.kind}`)).toEqual([
      "change chg.txt file", "create new.txt file", "delete old.txt file", `create ${SK} skill`, "create skillpack-lock.json lock",
    ]);
    expect(formatChangeDescriptions(d)).toContain("+ skillpack-lock.json  (lock)");
  });

  it("applies everything, including nested new folders", () => {
    const dir = tmp();
    put(dir, "gone.txt", "x");
    put(dir, `${SK}/SKILL.md`, "old");
    put(dir, `${SK}/stale.md`, "stale");
    applyChanges(dir, [
      { type: "write-skill-folder", path: SK, files: [f("SKILL.md", "new"), f("run.sh", "#!/bin/sh", 0o755)] },
      { type: "write-file", path: ".opencode/agents/a.md", content: "agent" },
      { type: "write-json", path: "skillpack.json", content: "{}\n", label: "config" },
      { type: "delete-file", path: "gone.txt" },
    ]);
    expect(readdirSync(join(dir, SK)).sort()).toEqual(["SKILL.md", "run.sh"]);
    expect(readFileSync(join(dir, ".opencode/agents/a.md"), "utf8")).toBe("agent");
    expect(existsSync(join(dir, "gone.txt"))).toBe(false);
    expect(readdirSync(dir).filter((n) => n.includes(".skillpack-"))).toEqual([]);
  });

  it("rolls back when a commit step fails", () => {
    const dir = tmp();
    put(dir, "gone.txt", "x");
    put(dir, `${SK}/SKILL.md`, "old");
    const ops: ProjectOp[] = [
      { type: "write-skill-folder", path: SK, files: [f("SKILL.md", "new")] },
      { type: "write-file", path: "deep/new/dir/a.md", content: "a" },
      { type: "delete-file", path: "gone.txt" },
      { type: "write-json", path: "skillpack.json", content: "{}\n", label: "config" },
    ];
    expect(() =>
      applyChanges(dir, ops, { beforeCommit: (i) => { if (i === 3) throw new Error("boom"); } }),
    ).toThrow("boom");
    expect(readFileSync(join(dir, SK, "SKILL.md"), "utf8")).toBe("old");
    expect(readFileSync(join(dir, "gone.txt"), "utf8")).toBe("x");
    expect(existsSync(join(dir, "deep"))).toBe(false);
    expect(existsSync(join(dir, "skillpack.json"))).toBe(false);
    expect(readdirSync(dir).sort()).toEqual([".agents", "gone.txt"]);
    expect(readdirSync(join(dir, ".agents/skills"))).toEqual(["acme-one"]);
  });

  it("rolls back when staging fails", () => {
    const dir = tmp();
    put(dir, "keep.txt", "k");
    expect(() =>
      applyChanges(dir, [
        { type: "write-file", path: "a.txt", content: "a" },
        { type: "write-file", path: "keep.txt/child", content: "conflict" },
      ]),
    ).toThrow();
    expect(readdirSync(dir)).toEqual(["keep.txt"]);
    expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("k");
  });
});
