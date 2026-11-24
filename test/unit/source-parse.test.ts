import { describe, expect, it } from "vitest";
import { matchesPackRef, normalizeSourceKey, parseSourceSpec, scopeFromOwner } from "../../src/core/source/parse.js";

describe("parseSourceSpec", () => {
  it("parses owner/repo", () => {
    expect(parseSourceSpec("morovid/skills")).toEqual({
      key: "https://github.com/morovid/skills", cloneUrl: "https://github.com/morovid/skills",
      owner: "morovid", repo: "skills", host: "github.com",
    });
  });
  it("parses versions, using the last @", () => {
    expect(parseSourceSpec("a/b@^1.2").version).toBe("^1.2");
    expect(parseSourceSpec("a/b@feature/x").version).toBe("feature/x");
    expect(parseSourceSpec("https://GitHub.com/a/b.git@v1.0.0")).toMatchObject({ key: "https://github.com/a/b", version: "v1.0.0" });
    expect(parseSourceSpec("git@github.com:a/b.git@1.0.0")).toMatchObject({ key: "ssh://git@github.com/a/b", version: "1.0.0" });
    expect(parseSourceSpec("ssh://git@host.io/a/b@main").version).toBe("main");
  });
  it("git@ prefix is not a version", () => {
    const s = parseSourceSpec("git@github.com:a/b");
    expect(s.version).toBeUndefined();
    expect(s).toMatchObject({ owner: "a", repo: "b", host: "github.com", key: "ssh://git@github.com/a/b", cloneUrl: "ssh://git@github.com/a/b" });
  });
  it("normalizes https", () => {
    expect(normalizeSourceKey("https://GitHub.COM/a/b.git/")).toBe("https://github.com/a/b");
    expect(normalizeSourceKey("a/b.git")).toBe("https://github.com/a/b");
    expect(normalizeSourceKey("https://gitlab.com/g/sub/b")).toBe("https://gitlab.com/g/sub/b");
  });
  it("keeps ssh keys distinct from https", () => {
    expect(normalizeSourceKey("ssh://git@GitHub.com/a/b.git")).toBe("ssh://git@github.com/a/b");
    expect(normalizeSourceKey("git@github.com:a/b")).toBe("ssh://git@github.com/a/b");
    expect(normalizeSourceKey("git@github.com:a/b")).not.toBe(normalizeSourceKey("a/b"));
  });
  it.each(["./x", "../x", "/x", "~", "~/x", "file:///tmp/x", "https://github.com/a/b/tree/main/sub", "https://github.com/a/b/sub",
    "a/b@", "a/b@ ", "", "a", "a/b/c", "http://github.com/a/b", "https://tok@github.com/a/b", "https://github.com/a"])(
    "rejects %j", (input) => {
      expect(() => parseSourceSpec(input)).toThrow(/Invalid source/);
    },
  );
  it("gives specific messages", () => {
    expect(() => parseSourceSpec("./x")).toThrow(/local paths/);
    expect(() => parseSourceSpec("file:///x")).toThrow(/file:\/\//);
    expect(() => parseSourceSpec("https://github.com/a/b/tree/main")).toThrow(/tree/);
    expect(() => parseSourceSpec("a/b@")).toThrow(/empty/);
  });
});

describe("matchesPackRef", () => {
  const key = "https://github.com/morovid/skills";
  it("matches scope and any source form", () => {
    expect(matchesPackRef("morovid", key, "morovid")).toBe(true);
    expect(matchesPackRef("morovid/skills", key, "x")).toBe(true);
    expect(matchesPackRef("https://GitHub.com/morovid/skills.git", key, "x")).toBe(true);
    expect(matchesPackRef("morovid/other", key, "x")).toBe(false);
    expect(matchesPackRef("garbage!", key, "x")).toBe(false);
    expect(matchesPackRef("git@github.com:morovid/skills", key, "x")).toBe(false);
  });
});

describe("scopeFromOwner", () => {
  it("normalizes", () => {
    expect(scopeFromOwner("MoroVid")).toBe("morovid");
    expect(scopeFromOwner("my.org  name")).toBe("my-org-name");
    expect(scopeFromOwner("--a--")).toBe("a");
    expect(scopeFromOwner("a_b")).toBe("a_b");
  });
  it("returns null when invalid", () => {
    expect(scopeFromOwner("...")).toBeNull();
    expect(scopeFromOwner("a".repeat(25))).toBeNull();
    expect(scopeFromOwner("a-_b")).toBeNull();
  });
});
