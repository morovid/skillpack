import { describe, expect, it } from "vitest";
import { latestInRange, latestOverall, resolveVersion, rewriteRange, type Remote } from "../../src/core/source/versions.js";

const sha = (n: number) => String(n).repeat(40).slice(0, 40);
function remote(tags: Record<string, string>, branches: Record<string, string> = { main: sha(9) }, branch: string | null = "main"): Remote {
  return {
    tags: new Map(Object.entries(tags)),
    branches: new Map(Object.entries(branches)),
    head: { ...(branch ? { branch } : {}), sha: sha(9) },
  };
}
const r = remote({ "v1.0.0": sha(1), "v1.2.0": sha(2), "1.3.0": sha(3), "v2.0.0": sha(4), "v3.0.0-beta.1": sha(5), "release": sha(6) }, { main: sha(9), dev: sha(8) });

describe("resolveVersion", () => {
  it("defaults to ^highest stable", () => {
    expect(resolveVersion(undefined, r)).toEqual({ kind: "tag", tag: "v2.0.0", commit: sha(4), saved: "^2.0.0" });
  });
  it("falls back to default branch", () => {
    expect(resolveVersion(undefined, remote({ foo: sha(1) }))).toEqual({ kind: "branch", tag: null, commit: sha(9), saved: "main" });
    expect(() => resolveVersion(undefined, remote({}, {}, null))).toThrow(/default branch/);
  });
  it("ignores prerelease-only tags for default", () => {
    expect(resolveVersion(undefined, remote({ "v1.0.0-rc.1": sha(1) })).kind).toBe("branch");
  });
  it("resolves exact versions and ranges", () => {
    expect(resolveVersion("1.2.0", r)).toMatchObject({ tag: "v1.2.0", commit: sha(2), saved: "1.2.0" });
    expect(resolveVersion("v1.2.0", r)).toMatchObject({ tag: "v1.2.0" });
    expect(resolveVersion("^1.0", r)).toMatchObject({ tag: "1.3.0", saved: "^1.0" });
    expect(resolveVersion("~1.2.0", r)).toMatchObject({ tag: "v1.2.0" });
    expect(resolveVersion(">=1 <2", r)).toMatchObject({ tag: "1.3.0" });
    expect(resolveVersion("^2", r)).toMatchObject({ tag: "v2.0.0" });
  });
  it("prereleases only when named", () => {
    expect(resolveVersion("^3.0.0-beta.0", r)).toMatchObject({ tag: "v3.0.0-beta.1" });
    expect(() => resolveVersion("^3", r)).toThrow(/No version/);
  });
  it("prefers the v form when both exist", () => {
    const d = remote({ "1.0.0": sha(1), "v1.0.0": sha(2) });
    expect(resolveVersion("1.0.0", d)).toMatchObject({ tag: "v1.0.0", commit: sha(2) });
    expect(resolveVersion(undefined, d).tag).toBe("v1.0.0");
  });
  it("uses peeled shas as given by the remote", () => {
    expect(resolveVersion("1.0.0", remote({ "v1.0.0": sha(7) })).commit).toBe(sha(7));
  });
  it("resolves tag names, branches and shas", () => {
    expect(resolveVersion("release", r)).toMatchObject({ kind: "tag", tag: "release", commit: sha(6) });
    expect(resolveVersion("dev", r)).toEqual({ kind: "branch", tag: null, commit: sha(8), saved: "dev" });
    expect(resolveVersion("a".repeat(40), r)).toMatchObject({ kind: "commit", commit: "a".repeat(40) });
    expect(resolveVersion("abc1234", r)).toEqual({ kind: "commit", tag: null, commit: "abc1234", saved: "abc1234" });
  });
  it("errors with available versions", () => {
    expect(() => resolveVersion("nope", r)).toThrow(/v2\.0\.0.*branches: main, dev/);
    expect(() => resolveVersion("^9", r)).toThrow(/No version/);
    expect(() => resolveVersion("nope", remote({}))).toThrow(/no semver tags/);
    expect(() => resolveVersion(" ", r)).toThrow(/empty/);
  });
});

describe("latest helpers", () => {
  it("latestInRange / latestOverall", () => {
    expect(latestInRange("^1.0.0", r)?.tag).toBe("1.3.0");
    expect(latestInRange("^4", r)).toBeNull();
    expect(latestInRange("main", r)).toBeNull();
    expect(latestOverall(r)?.tag).toBe("v2.0.0");
    expect(latestOverall(r, { includePrerelease: true })?.tag).toBe("v3.0.0-beta.1");
    expect(latestOverall(remote({}))).toBeNull();
  });
});

describe("rewriteRange", () => {
  it.each([
    ["^1.2.0", "2.0.0", "^2.0.0"],
    ["^1.2", "v2.0.0", "^2.0.0"],
    ["~1.2.0", "2.1.0", "~2.1.0"],
    ["1.2.0", "2.0.0", "2.0.0"],
    ["v1.2.0", "2.0.0", "v2.0.0"],
    [">=1 <2", "2.0.0", "^2.0.0"],
    ["^1 || ^2", "3.0.0", "^3.0.0"],
    ["1.x", "2.0.0", "^2.0.0"],
  ])("%s + %s -> %s", (old, next, out) => {
    expect(rewriteRange(old, next)).toEqual({ version: out });
  });
  it.each(["main", "feature/x", "release", "a".repeat(40), "abc1234"])("leaves %s alone", (old) => {
    const res = rewriteRange(old, "2.0.0");
    expect(res.version).toBeNull();
    expect(res.reason).toBeTruthy();
  });
});
