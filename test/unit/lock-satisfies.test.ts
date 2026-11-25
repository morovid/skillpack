import { describe, expect, it } from "vitest";
import { lockSatisfies } from "../../src/core/source/versions.js";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";
const tag = (version: string) => ({ version, commit: SHA });
const branch = { version: null, commit: SHA };

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
    expect(lockSatisfies("stable", branch)).toBe(true); // branch packs aren't re-resolved (documented limit)
  });
  it("branches are satisfied by non-tag locks only", () => {
    expect(lockSatisfies("main", branch)).toBe(true);
    expect(lockSatisfies("main", tag("v1.0.0"))).toBe(false);
  });
  it("commits match by prefix", () => {
    expect(lockSatisfies(SHA, branch)).toBe(true);
    expect(lockSatisfies("abcdef0", branch)).toBe(true);
    expect(lockSatisfies("ABCDEF0", branch)).toBe(true);
    expect(lockSatisfies("abcdef1", branch)).toBe(false);
    expect(lockSatisfies("abcdef0", tag("v1.0.0"))).toBe(false);
    expect(lockSatisfies("1234567", { version: null, commit: "1234567" + "0".repeat(33) })).toBe(true);
  });
  it("rejects an empty request", () => {
    expect(lockSatisfies("  ", branch)).toBe(false);
  });
});
