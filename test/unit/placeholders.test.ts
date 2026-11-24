import { describe, expect, it } from "vitest";
import { findPlaceholders, tokenize } from "../../src/core/placeholders.js";

describe("placeholder tokenizer", () => {
  it("finds the three forms", () => {
    const t = findPlaceholders("a {{agent:scout}} b {{skill:plan_code}} c {{scope}}");
    expect(t.map((x) => x.kind)).toEqual(["agent", "skill", "scope"]);
    expect(t[0]).toMatchObject({ name: "scout", col: 3 });
    expect(t[1]).toMatchObject({ name: "plan_code" });
  });
  it("round-trips the text", () => {
    const src = "x {{scope}} \\{{ y {{ bad }}\n{{agent:a}}";
    expect(tokenize(src).map((t) => t.raw).join("")).toBe(src);
  });
  it("treats \\{{ as an escape, not a placeholder", () => {
    const t = tokenize("\\{{scope}}");
    expect(t[0]?.kind).toBe("escape");
    expect(findPlaceholders("\\{{scope}}")).toEqual([]);
  });
  it("flags unknown forms", () => {
    for (const s of ["{{ scope }}", "{{agents:x}}", "{{agent:}}", "{{agent:Bad}}", "{{scope:x}}", "{{foo}}"]) {
      expect(findPlaceholders(s)[0]?.kind, s).toBe("unknown");
    }
  });
  it("reports line numbers", () => {
    const t = findPlaceholders("one\ntwo\n  {{scope}}\n{{foo}}");
    expect(t.map((x) => [x.line, x.col])).toEqual([[3, 3], [4, 1]]);
  });
  it("flags unclosed {{ with line and column", () => {
    const t = findPlaceholders("ok\na {{ b\nc }}");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "unclosed", line: 2, col: 3 });
    expect(tokenize("a {{ b").map((x) => x.raw).join("")).toBe("a {{ b");
  });
  it("does not flag an escaped {{", () => {
    expect(findPlaceholders("a \\{{ b")).toEqual([]);
  });
});
