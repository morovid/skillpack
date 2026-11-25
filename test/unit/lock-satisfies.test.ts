import { describe, expect, it } from "vitest";
import { formatLockedRef } from "../../src/core/project/lock.js";
import { lockSatisfies, resolvedRef } from "../../src/core/source/versions.js";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";
const tag = (t: string) => ({ ref: `refs/tags/${t}`, commit: SHA });
const branch = (b: string) => ({ ref: `refs/heads/${b}`, commit: SHA });
const pinned = { ref: null, commit: SHA };

describe("lockSatisfies", () => {
  it("ranges need a locked semver tag inside them", () => {
    expect(lockSatisfies("^1.0.0", tag("v1.2.0"))).toBe(true);
    expect(lockSatisfies("^1.0.0", tag("1.9.9"))).toBe(true);
    expect(lockSatisfies("^1.0.0", tag("v2.0.0"))).toBe(false);
    expect(lockSatisfies("~1.1.0", tag("v1.2.0"))).toBe(false);
    expect(lockSatisfies("1.0.0", tag("v1.0.0"))).toBe(true);
    expect(lockSatisfies("^1.0.0", branch("main"))).toBe(false);
    expect(lockSatisfies("^1.0.0", pinned)).toBe(false);
    expect(lockSatisfies("^1.0.0", tag("stable"))).toBe(false); // not a semver tag
  });
  it("follows npm prerelease rules", () => {
    expect(lockSatisfies("^1.0.0", tag("v1.1.0-beta.1"))).toBe(false);
    expect(lockSatisfies("^1.1.0-beta.0", tag("v1.1.0-beta.1"))).toBe(true);
    expect(lockSatisfies("^1.0.0", tag("v2.0.0-beta.1"))).toBe(false);
  });
  it("a name matches the locked tag or branch of that name", () => {
    expect(lockSatisfies("stable", tag("stable"))).toBe(true);
    expect(lockSatisfies("stable", tag("other"))).toBe(false);
    expect(lockSatisfies("main", branch("main"))).toBe(true);
    expect(lockSatisfies("feature/x", branch("feature/x"))).toBe(true);
    expect(lockSatisfies("main", branch("feature/x"))).toBe(false);
  });
  it("switching branches is noticed; tag and branch are not mixed up", () => {
    expect(lockSatisfies("dev", branch("main"))).toBe(false);
    expect(lockSatisfies("main", tag("v1.0.0"))).toBe(false);
    expect(lockSatisfies("stable", branch("main"))).toBe(false);
    expect(lockSatisfies("main", pinned)).toBe(false);
  });
  it("a tag and a branch with the same name both work", () => {
    expect(lockSatisfies("release", tag("release"))).toBe(true);
    expect(lockSatisfies("release", branch("release"))).toBe(true);
  });
  it("commits match by prefix, however they were locked", () => {
    for (const locked of [pinned, branch("main"), tag("v1.0.0")]) {
      expect(lockSatisfies(SHA, locked)).toBe(true);
      expect(lockSatisfies("abcdef0", locked)).toBe(true);
      expect(lockSatisfies("ABCDEF0", locked)).toBe(true);
      expect(lockSatisfies("abcdef1", locked)).toBe(false);
    }
    expect(lockSatisfies("1234567", { ref: null, commit: "1234567" + "0".repeat(33) })).toBe(true);
  });
  it("rejects an empty request", () => {
    expect(lockSatisfies("  ", pinned)).toBe(false);
  });
});

describe("refs", () => {
  it("resolvedRef maps resolved versions to lock refs", () => {
    expect(resolvedRef({ kind: "tag", tag: "v1.0.0", commit: SHA, saved: "^1.0.0" })).toBe("refs/tags/v1.0.0");
    expect(resolvedRef({ kind: "branch", tag: null, commit: SHA, saved: "main" })).toBe("refs/heads/main");
    expect(resolvedRef({ kind: "commit", tag: null, commit: SHA, saved: "abcdef0" })).toBeNull();
  });
  it("formatLockedRef shows tags, branches with a short commit, and bare commits", () => {
    expect(formatLockedRef("refs/tags/v1.0.0", SHA)).toBe("v1.0.0");
    expect(formatLockedRef("refs/heads/main", SHA)).toBe("main@abcdef0");
    expect(formatLockedRef(null, SHA)).toBe("abcdef0");
  });
});
