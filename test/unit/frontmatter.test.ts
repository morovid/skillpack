import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../src/core/frontmatter.js";

describe("frontmatter", () => {
  it("parses data and body", () => {
    const r = parseFrontmatter('---\nname: a\nmetadata:\n  internal: "true"\n---\n# Body\n');
    expect(r).toMatchObject({ kind: "ok", data: { name: "a", metadata: { internal: "true" } } });
    expect(r.body).toBe("# Body\n");
  });
  it("keeps YAML booleans as booleans", () => {
    const r = parseFrontmatter("---\nmetadata:\n  internal: true\n---\n");
    expect(r.kind === "ok" && (r.data.metadata as { internal: unknown }).internal).toBe(true);
  });
  it("handles none, unclosed, invalid and non-mapping", () => {
    expect(parseFrontmatter("# Hi").kind).toBe("none");
    expect(parseFrontmatter("---\na: 1\n").kind).toBe("error");
    expect(parseFrontmatter("---\na: [\n---\n").kind).toBe("error");
    expect(parseFrontmatter("---\n- a\n---\n").kind).toBe("error");
  });
  it("handles CRLF and empty frontmatter", () => {
    expect(parseFrontmatter("---\r\nname: a\r\n---\r\nx")).toMatchObject({ kind: "ok", data: { name: "a" } });
    expect(parseFrontmatter("---\n---\nx")).toMatchObject({ kind: "ok", data: {} });
  });
});
