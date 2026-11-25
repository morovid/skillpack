import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCI } from "../../src/core/ci.js";
import {
  emptyConfig, emptyLock, emptyModels, getModel, packBindings, readConfig, readLock, readModels, serializeConfig,
  serializeLock, serializeModels, setModel, removePackModels,
} from "../../src/core/project/index.js";

const tmp = () => mkdtempSync(join(tmpdir(), "sp-proj-"));
const SHA = "a".repeat(40);
const H = "sha256-" + "b".repeat(64);

describe("selection config", () => {
  const doc = {
    $schema: "https://skillpack.morovid.com/schemas/v1/config.json",
    packs: {
      "https://github.com/z/last": { version: "main", harnesses: ["opencode"], skills: ["a"], scope: "zl", agents: {}, note: "keep me" },
      "https://github.com/a/first": {
        version: "^1.0.0",
        harnesses: ["opencode", "codex"],
        agents: { scout: { opencode: "existing:explore", extra: 1 }, author: { codex: "none" } },
      },
    },
    custom: { x: 1 },
  };

  it("reads, tolerates unknown keys, and round-trips them in stable format", () => {
    const dir = tmp();
    writeFileSync(join(dir, "skillpack.json"), JSON.stringify(doc));
    const r = readConfig(dir);
    if (r.status !== "ok") throw new Error(JSON.stringify(r));
    expect(r.unknownKeys.sort()).toEqual(["/custom", "/packs/https:~1~1github.com~1a~1first/agents/scout/extra", "/packs/https:~1~1github.com~1z~1last/note"].sort());
    expect(Object.keys(r.value.packs)).toEqual(["https://github.com/z/last", "https://github.com/a/first"]);
    expect(r.value.packs["https://github.com/a/first"]!.skills).toBe("*");

    r.value.packs["https://github.com/new/pack"] = { version: "v1", harnesses: ["codex"], skills: "*", agents: { s: { codex: "generate" } } };
    r.value.packs["https://github.com/a/first"]!.version = "^2.0.0";
    const text = serializeConfig(r.value);
    expect(text.endsWith("}\n")).toBe(true);
    const out = JSON.parse(text);
    expect(Object.keys(out)).toEqual(["$schema", "packs", "custom"]);
    expect(Object.keys(out.packs)).toEqual(["https://github.com/z/last", "https://github.com/a/first", "https://github.com/new/pack"]);
    expect(out.packs["https://github.com/z/last"].note).toBe("keep me");
    expect(out.packs["https://github.com/a/first"].agents.scout).toEqual({ opencode: "existing:explore", extra: 1 });
    expect(out.packs["https://github.com/a/first"].version).toBe("^2.0.0");
    expect(Object.keys(out.packs["https://github.com/z/last"])).toEqual(["version", "harnesses", "skills", "scope", "agents", "note"]);
    expect(text).toContain('\n  "packs": {\n    "https://');
    writeFileSync(join(dir, "skillpack.json"), text);
    expect(readConfig(dir)).toMatchObject({ status: "ok" });
  });

  it("reports missing and invalid files", () => {
    const dir = tmp();
    expect(readConfig(dir)).toEqual({ status: "missing" });
    writeFileSync(join(dir, "skillpack.json"), "{ nope");
    expect(readConfig(dir)).toMatchObject({ status: "invalid" });
    writeFileSync(join(dir, "skillpack.json"), JSON.stringify({ packs: { x: { harnesses: ["vim"] } } }));
    const r = readConfig(dir);
    expect(r.status === "invalid" && r.errors.join("\n")).toMatch(/version|harnesses/);
    writeFileSync(join(dir, "skillpack.json"), JSON.stringify({ $schema: "https://skillpack.morovid.com/schemas/v9/config.json", packs: {} }));
    expect(readConfig(dir)).toMatchObject({ status: "invalid" });
  });

  it("empty config serializes", () => {
    expect(JSON.parse(serializeConfig(emptyConfig()))).toEqual({ $schema: "https://skillpack.morovid.com/schemas/v1/config.json", packs: {} });
  });

  it("resolves bindings, defaulting to generate", () => {
    const b = packBindings({ version: "1", harnesses: ["opencode", "codex"], skills: "*", agents: { a: { opencode: "existing:explore" } } }, ["a", "b"]);
    expect(b.a).toEqual({ opencode: { kind: "existing", id: "explore" }, codex: { kind: "generate" } });
    expect(b.b?.codex).toEqual({ kind: "generate" });
  });
});

describe("lock file", () => {
  it("serializes deterministically with sorted keys and round-trips", () => {
    const a = emptyLock("0.1.0");
    a.packs["https://b"] = { ref: null, commit: SHA, skills: { ".agents/skills/z": H, ".agents/skills/a": H } };
    a.packs["https://a"] = { ref: "refs/tags/v1.0.0", commit: SHA, skills: {} };
    const b = emptyLock("0.1.0");
    b.packs["https://a"] = { skills: {}, commit: SHA, ref: "refs/tags/v1.0.0" };
    b.packs["https://b"] = { skills: { ".agents/skills/a": H, ".agents/skills/z": H }, commit: SHA, ref: null };
    expect(serializeLock(a)).toBe(serializeLock(b));
    const out = JSON.parse(serializeLock(a));
    expect(Object.keys(out)).toEqual(["$schema", "cli", "packs"]);
    expect(Object.keys(out.packs)).toEqual(["https://a", "https://b"]);
    expect(Object.keys(out.packs["https://b"].skills)).toEqual([".agents/skills/a", ".agents/skills/z"]);
    const dir = tmp();
    writeFileSync(join(dir, "skillpack-lock.json"), serializeLock(a));
    const r = readLock(dir);
    expect(r.status === "ok" && r.value.packs["https://b"]!.ref).toBeNull();
  });
  it("rejects bad hashes and unknown keys", () => {
    const dir = tmp();
    writeFileSync(join(dir, "skillpack-lock.json"), JSON.stringify({ cli: "1", packs: { x: { ref: null, commit: "nope", skills: {} } } }));
    expect(readLock(dir).status).toBe("invalid");
    writeFileSync(join(dir, "skillpack-lock.json"), JSON.stringify({ cli: "1", packs: {}, extra: 1 }));
    expect(readLock(dir).status).toBe("invalid");
    const entry = (e: Record<string, unknown>) => JSON.stringify({ cli: "1", packs: { x: { commit: SHA, skills: {}, ...e } } });
    for (const bad of [{}, { ref: "main" }, { ref: "refs/remotes/x" }, { ref: "refs/tags/" }, { ref: null, version: "v1" }, { ref: null, branch: "main" }]) {
      writeFileSync(join(dir, "skillpack-lock.json"), entry(bad));
      expect(readLock(dir).status, JSON.stringify(bad)).toBe("invalid");
    }
    for (const good of [{ ref: null }, { ref: "refs/tags/v1.0.0" }, { ref: "refs/heads/feature/x" }]) {
      writeFileSync(join(dir, "skillpack-lock.json"), entry(good));
      expect(readLock(dir).status, JSON.stringify(good)).toBe("ok");
    }
    writeFileSync(join(dir, "skillpack-lock.json"), JSON.stringify({ packs: {} }));
    expect(readLock(dir).status).toBe("invalid"); // cli is required
    expect(readLock(tmp()).status).toBe("missing");
  });
});

describe("models file", () => {
  it("gets, sets, removes and serializes sorted", () => {
    const m = emptyModels();
    setModel(m, "https://p", "sonnet-5.5", "codex", "gpt-x");
    setModel(m, "https://p", "sonnet-5.5", "opencode", "gh/claude-sonnet-5.5");
    setModel(m, "https://a", "z", "codex", "z");
    expect(getModel(m, "https://p", "sonnet-5.5", "opencode")).toBe("gh/claude-sonnet-5.5");
    expect(getModel(m, "https://p", "nope", "codex")).toBeUndefined();
    const text = serializeModels(m);
    expect(Object.keys(JSON.parse(text).packs)).toEqual(["https://a", "https://p"]);
    expect(Object.keys(JSON.parse(text).packs["https://p"]["sonnet-5.5"])).toEqual(["opencode", "codex"]);
    const dir = tmp();
    writeFileSync(join(dir, "skillpack.models.json"), text);
    const r = readModels(dir);
    expect(r.status === "ok" && getModel(r.value, "https://p", "sonnet-5.5", "codex")).toBe("gpt-x");
    removePackModels(m, "https://p");
    expect(Object.keys(m.packs)).toEqual(["https://a"]);
    expect(readFileSync(join(dir, "skillpack.models.json"), "utf8")).toBe(text);
  });
  it("rejects invalid mappings", () => {
    const dir = tmp();
    writeFileSync(join(dir, "skillpack.models.json"), JSON.stringify({ packs: { p: { m: { opencode: "no-provider" } } } }));
    expect(readModels(dir).status).toBe("invalid");
  });
});

describe("isCI", () => {
  it("treats any non-empty value except false and 0 as set", () => {
    expect(isCI({ CI: "true" })).toBe(true);
    expect(isCI({ CI: "1" })).toBe(true);
    expect(isCI({ CI: "false" })).toBe(false);
    expect(isCI({ CI: "0" })).toBe(false);
    expect(isCI({ CI: "" })).toBe(false);
    expect(isCI({})).toBe(false);
  });
});
