import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchCommit, fetchRef, lsRemote, parseLsRemote, runGit, withTempCheckout, GitError } from "../../src/core/git/index.js";

let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}

describe("parseLsRemote", () => {
  it("prefers peeled tag shas", () => {
    const out = [
      "ref: refs/heads/main\tHEAD", "1".repeat(40) + "\tHEAD", "1".repeat(40) + "\trefs/heads/main",
      "2".repeat(40) + "\trefs/tags/v1.0.0", "3".repeat(40) + "\trefs/tags/v1.0.0^{}", "4".repeat(40) + "\trefs/tags/light", "",
    ].join("\n");
    const r = parseLsRemote(out);
    expect(r.tags.get("v1.0.0")).toBe("3".repeat(40));
    expect(r.tags.get("light")).toBe("4".repeat(40));
    expect(r.head).toEqual({ branch: "main", sha: "1".repeat(40) });
    expect([...r.branches.keys()]).toEqual(["main"]);
  });
  it("fails on an empty repo", () => {
    expect(() => parseLsRemote("")).toThrow(GitError);
  });
});

describe.skipIf(!hasGit)("git wrapper", () => {
  let root: string;
  let url: string;
  const shas: Record<string, string> = {};
  const git = (args: string[], cwd: string) => runGit(args, { cwd });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "skillpack-test-"));
    const bare = join(root, "bare.git");
    const work = join(root, "work");
    mkdirSync(work);
    await git(["init", "--bare", "--quiet", "--initial-branch=main", bare], root);
    await git(["init", "--quiet", "--initial-branch=main"], work);
    await git(["config", "user.name", "Test"], work);
    await git(["config", "user.email", "t@example.com"], work);
    await git(["config", "commit.gpgsign", "false"], work);
    await git(["config", "tag.gpgsign", "false"], work);
    for (const [i, v] of ["v1.0.0", "v1.1.0", "v2.0.0"].entries()) {
      writeFileSync(join(work, "file.txt"), `content ${v}\n`);
      await git(["add", "."], work);
      await git(["commit", "--quiet", "-m", `release ${i}`], work);
      shas[v] = (await git(["rev-parse", "HEAD"], work)).trim();
      if (v === "v1.1.0") await git(["tag", "-a", v, "-m", v], work);
      else await git(["tag", v], work);
    }
    await git(["remote", "add", "origin", `file://${bare}`], work);
    await git(["push", "--quiet", "origin", "main", "--tags"], work);
    url = `file://${bare}`;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("lsRemote", async () => {
    const r = await lsRemote(url, { nonInteractive: true });
    expect([...r.tags.keys()].sort()).toEqual(["v1.0.0", "v1.1.0", "v2.0.0"]);
    expect(r.tags.get("v1.1.0")).toBe(shas["v1.1.0"]);
    expect(r.branches.get("main")).toBe(shas["v2.0.0"]);
    expect(r.head).toEqual({ branch: "main", sha: shas["v2.0.0"] });
  });

  it("fetchCommit", async () => {
    await withTempCheckout(async (dir) => {
      const dest = join(dir, "c");
      expect(await fetchCommit(url, shas["v1.0.0"]!, dest)).toBe(shas["v1.0.0"]);
      expect(readFileSync(join(dest, "file.txt"), "utf8")).toBe("content v1.0.0\n");
    });
  });

  it("fetchCommit with an abbreviated sha falls back to a full fetch", async () => {
    await withTempCheckout(async (dir) => {
      const dest = join(dir, "c");
      expect(await fetchCommit(url, shas["v1.1.0"]!.slice(0, 8), dest)).toBe(shas["v1.1.0"]);
    });
  });

  it("fetchRef for tag and branch", async () => {
    await withTempCheckout(async (dir) => {
      expect(await fetchRef(url, "v1.1.0", join(dir, "t"))).toBe(shas["v1.1.0"]);
      expect(await fetchRef(url, "main", join(dir, "b"))).toBe(shas["v2.0.0"]);
      expect(readFileSync(join(dir, "t", "file.txt"), "utf8")).toBe("content v1.1.0\n");
    });
  });

  it("withTempCheckout removes the directory, even on failure", async () => {
    let seen = "";
    await expect(withTempCheckout(async (d) => { seen = d; throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(seen)).toBe(false);
  });

  it("reports failures with stderr", async () => {
    await expect(lsRemote(`file://${root}/missing.git`)).rejects.toThrow(/git ls-remote.*failed/);
  });
});
