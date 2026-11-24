import { describe, expect, it } from "vitest";
import { PlaceholderError, renderPlaceholders } from "../../src/core/placeholders.js";
import { createPlainContext, renderSkill, rewriteSkillLinks } from "../../src/core/render/index.js";
import type { RenderContext, SkillSourceFiles } from "../../src/core/render/index.js";
import { scopedName, toKebab } from "../../src/core/names.js";

const resolver = { scope: "sc", agent: (n: string) => `<agent ${n}>`, skill: (n: string) => `<skill ${n}>` };

describe("renderPlaceholders", () => {
  it("replaces all three kinds", () => {
    expect(renderPlaceholders("{{agent:a}} {{skill:b_c}} {{scope}}", resolver)).toBe("<agent a> <skill b_c> sc");
  });
  it("turns \\{{ into a literal {{ and leaves the rest alone", () => {
    expect(renderPlaceholders("x \\{{scope}} y {{scope}}", resolver)).toBe("x {{scope}} y sc");
  });
  it("throws on unknown and unclosed", () => {
    expect(() => renderPlaceholders("a\n  {{ scope }}", resolver)).toThrow(PlaceholderError);
    expect(() => renderPlaceholders("a {{", resolver)).toThrow(/unclosed.*line 1, column 3/);
  });
});

const names = ["plan_code", "review"];
const plain: RenderContext = createPlainContext({
  scope: "my_pack",
  skillNames: names,
  fallbacks: new Map([["scout", "a scout"]]),
});
const install: RenderContext = {
  mode: "install",
  scope: "my_pack",
  skillNames: new Set(names),
  skillFolderName: (n) => scopedName("my_pack", n),
  resolver: { scope: "my_pack", agent: (n) => `\`my-pack-${n}\``, skill: (n) => scopedName("my_pack", n) },
};

const f = (path: string, text: string | Buffer, mode = 0o644) => ({
  path,
  content: Buffer.isBuffer(text) ? text : Buffer.from(text),
  mode,
});
const skill = (extra: SkillSourceFiles["files"] = []): SkillSourceFiles => ({
  name: "plan_code",
  files: [
    f(
      "SKILL.md",
      `---
# top comment
name: plan_code
description: "Use {{agent:scout}} in {{scope}}"
metadata:
  internal: "true"
  author: me
license: MIT
---

# Title

See [other](../review/SKILL.md#x), [web](https://x.io/../review), [anchor](#a), [none](../nothing/y.md), [own](references/a.md).
\\{{literal}} {{skill:plan_code}}
`,
    ),
    f("references/a.md", "Up: [r](../../review/SKILL.md) / [bad](../review/SKILL.md)\n\n[ref]: ../../plan_code/SKILL.md \"t\"\n"),
    ...extra,
  ],
});

describe("renderSkill", () => {
  it("plain: kebab folder, frontmatter rewrite, comment, placeholders, links", () => {
    const out = renderSkill(skill(), plain);
    expect(out.map((o) => o.path)).toEqual(["plan-code/SKILL.md", "plan-code/references/a.md"]);
    const md = out[0]!.content.toString();
    expect(md).toBe(`---
# top comment
name: plan-code
description: "Use a scout in my_pack"
metadata:
  author: me
license: MIT
---
<!-- generated from src/skills/plan_code by skillpack build; edit the source -->

# Title

See [other](../review/SKILL.md#x), [web](https://x.io/../review), [anchor](#a), [none](../nothing/y.md), [own](references/a.md).
{{literal}} plan-code
`);
    expect(out[1]!.content.toString()).toBe(
      'Up: [r](../../review/SKILL.md) / [bad](../review/SKILL.md)\n\n[ref]: ../../plan-code/SKILL.md "t"\n',
    );
  });

  it("plain: removes metadata entirely when it becomes empty", () => {
    const s: SkillSourceFiles = {
      name: "review",
      files: [f("SKILL.md", '---\nname: review\ndescription: d\nmetadata:\n  internal: "true"\n---\nBody\n')],
    };
    expect(renderSkill(s, plain)[0]!.content.toString()).toBe(
      "---\nname: review\ndescription: d\n---\n<!-- generated from src/skills/review by skillpack build; edit the source -->\n\nBody\n",
    );
  });

  it("install: prefixed folder and name, links get the prefix, no comment", () => {
    const out = renderSkill(skill(), install);
    expect(out.map((o) => o.path)).toEqual(["my-pack-plan-code/SKILL.md", "my-pack-plan-code/references/a.md"]);
    const md = out[0]!.content.toString();
    expect(md).toContain("name: my-pack-plan-code\n");
    expect(md).toContain('description: "Use `my-pack-scout` in my_pack"');
    expect(md).toContain("[other](../my-pack-review/SKILL.md#x)");
    expect(md).not.toContain("generated from");
    expect(md).not.toContain("internal");
    expect(out[1]!.content.toString()).toContain("](../../my-pack-review/SKILL.md)");
  });

  it("copies binary files byte-for-byte and keeps the executable bit", () => {
    const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x7b, 0x7b, 0xff]);
    const out = renderSkill(skill([f("assets/p.png", bin), f("scripts/run.sh", "echo {{scope}}", 0o755), f("data.json", '{"s":"{{scope}}"}')]), plain);
    const by = Object.fromEntries(out.map((o) => [o.path, o]));
    expect(by["plan-code/assets/p.png"]!.content.equals(bin)).toBe(true);
    expect(by["plan-code/scripts/run.sh"]!.mode).toBe(0o755);
    expect(by["plan-code/scripts/run.sh"]!.content.toString()).toBe("echo {{scope}}");
    expect(by["plan-code/data.json"]!.content.toString()).toBe('{"s":"my_pack"}');
  });

  it("is deterministic and sorted", () => {
    const a = renderSkill(skill([f("z.txt", "z"), f("a.txt", "a")]), plain);
    const b = renderSkill(skill([f("a.txt", "a"), f("z.txt", "z")]), plain);
    expect(a).toEqual(b);
    expect(a.map((o) => o.path)).toEqual([...a.map((o) => o.path)].sort());
  });

  it("keeps CRLF files CRLF", () => {
    const s: SkillSourceFiles = { name: "review", files: [f("SKILL.md", "---\r\nname: review\r\ndescription: d\r\n---\r\n\r\nBody\r\n")] };
    expect(renderSkill(s, plain)[0]!.content.toString()).toBe(
      "---\r\nname: review\r\ndescription: d\r\n---\r\n<!-- generated from src/skills/review by skillpack build; edit the source -->\r\n\r\nBody\r\n",
    );
  });
});

describe("rewriteSkillLinks", () => {
  it("only rewrites links that reach the skills folder from the file's depth", () => {
    const set = new Set(["a_b"]);
    const fix = toKebab;
    expect(rewriteSkillLinks("[x](../a_b/y.md?q=1#h)", 0, set, fix)).toBe("[x](../a-b/y.md?q=1#h)");
    expect(rewriteSkillLinks("[x](../a_b)", 1, set, fix)).toBe("[x](../a_b)");
    expect(rewriteSkillLinks("[x](/a_b/y) [y](mailto:a_b) [z](<../a_b/y.md>)", 0, set, fix)).toBe("[x](/a_b/y) [y](mailto:a_b) [z](<../a-b/y.md>)");
  });
});
