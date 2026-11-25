import { describe, expect, it } from "vitest";
import { lockSatisfies } from "../../src/core/source/versions.js";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";
const tag = (version: string) => ({ version, commit: SHA });
const branch = { version: null, branch: "main", commit: SHA };
const oldBranchLock = { version: null, commit: SHA }; // written before `branch` existed

describe("lockSatisfies", () => {
  it("ranges need a locked semver tag inside them", () => {
    expect(lockSatisfies("^1.0.0", tag("v1.2.0"))).toBe(true);
    expect(lockSatisfies("^1.0.0", tag("1.9.9"))).toBe(true);
    expect(lockSatisfies("^1.0.0", tag("v2.0.0"))).toBe(false);
    expect(lockSatisfies("~1.1.0", tag("v1.2.0"))).toBe(false);
    expect(lockSatisfies("1.0.0", tag("v1.0.0"))).toBe(true);
    expect(lockSatisfies("^1.0.0", branch)).toBe(false);
  });
  it("follows npm prerelease rules", () => {
    expect(lockSatisfies("^1.0.0", tag("v1.1.0-beta.1"))).toBe(false);
    expect(lockSatisfies("^1.1.0-beta.0", tag("v1.1.0-beta.1"))).toBe(true);
    expect(lockSatisfies("^1.0.0", tag("v2.0.0-beta.1"))).toBe(false);
  });
  it("exact tag names need the same locked tag", () => {
    expect(lockSatisfies("stable", tag("stable"))).toBe(true);
    expect(lockSatisfies("stable", tag("other"))).toBe(false);
    expect(lockSatisfies("stable", branch)).toBe(false); // locked from branch main, not tag "stable"
  });
  it("branches are satisfied only by the locked branch", () => {
    expect(lockSatisfies("main", branch)).toBe(true);
    expect(lockSatisfies("dev", branch)).toBe(false); // switching branches re-resolves
    expect(lockSatisfies("main", tag("v1.0.0"))).toBe(false);
    expect(lockSatisfies("main", { version: null, branch: "feature/x", commit: SHA })).toBe(false);
    expect(lockSatisfies("feature/x", { version: null, branch: "feature/x", commit: SHA })).toBe(true);
    expect(lockSatisfies("^1.0.0", branch)).toBe(false);
  });
  it("an old lock entry without branch doesn't satisfy a branch request", () => {
    expect(lockSatisfies("main", oldBranchLock)).toBe(false);
    expect(lockSatisfies("main", { ...oldBranchLock, branch: null })).toBe(false);
    expect(lockSatisfies("abcdef0", oldBranchLock)).toBe(true); // commits still match by prefix
  });
  it("commits match by prefix", () => {
    expect(lockSatisfies(SHA, branch)).toBe(true);
    expect(lockSatisfies("abcdef0", branch)).toBe(true);
    expect(lockSatisfies("ABCDEF0", branch)).toBe(true);
    expect(lockSatisfies("abcdef1", branch)).toBe(false);
    expect(lockSatisfies("abcdef0", tag("v1.0.0"))).toBe(true); // same commit, however it was locked
    expect(lockSatisfies("abcdef1", tag("v1.0.0"))).toBe(false);
    expect(lockSatisfies("1234567", { version: null, commit: "1234567" + "0".repeat(33) })).toBe(true);
  });
  it("rejects an empty request", () => {
    expect(lockSatisfies("  ", branch)).toBe(false);
  });
});
