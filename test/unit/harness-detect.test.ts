import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectHarnesses, type DetectEnv } from "../../src/core/harness-detect.js";
import { selectHarnesses, selectSkills, InstallError } from "../../src/core/install/select.js";

const env = (existing: string[], over: Partial<DetectEnv> = {}): DetectEnv => ({
  pathDirs: ["/usr/bin", "/opt/bin"],
  projectDir: "/proj",
  home: "/home/u",
  exists: (p) => existing.includes(p),
  ...over,
});

describe("detectHarnesses", () => {
  it("finds binaries, project folders and user config folders", () => {
    expect(detectHarnesses(env([]))).toEqual([]);
    expect(detectHarnesses(env([join("/opt/bin", "opencode")]))).toEqual(["opencode"]);
    expect(detectHarnesses(env([join("/usr/bin", "codex.exe")]))).toEqual(["codex"]);
    expect(detectHarnesses(env(["/proj/.opencode", "/proj/.codex"]))).toEqual(["opencode", "codex"]);
    expect(detectHarnesses(env(["/home/u/.config/opencode"]))).toEqual(["opencode"]);
    expect(detectHarnesses(env(["/xdg/opencode", "/home/u/.codex"], { xdgConfigHome: "/xdg" }))).toEqual(["opencode", "codex"]);
  });
});

describe("selectHarnesses / selectSkills", () => {
  it("applies flags, manifest restrictions and detection", () => {
    expect(selectHarnesses({ flags: ["codex,opencode"], supported: null, detected: [] })).toEqual(["opencode", "codex"]);
    expect(selectHarnesses({ flags: ["*"], supported: ["codex"], detected: [] })).toEqual(["codex"]);
    expect(selectHarnesses({ flags: [], supported: ["codex"], detected: ["opencode", "codex"] })).toEqual(["codex"]);
    expect(() => selectHarnesses({ flags: ["codex"], supported: ["opencode"], detected: [] })).toThrow(InstallError);
    expect(() => selectHarnesses({ flags: ["vim"], supported: null, detected: [] })).toThrow(/unknown harness/);
    expect(() => selectHarnesses({ flags: [], supported: null, detected: [] })).toThrow(/pass -a/);
  });
  it("selects skills", () => {
    expect(selectSkills({ flags: [], available: ["a"] })).toBe("*");
    expect(selectSkills({ flags: ["a,b", "a"], available: ["a", "b"] })).toEqual(["a", "b"]);
    expect(() => selectSkills({ flags: ["z"], available: ["a"] })).toThrow(/no skill "z"/);
  });
});
