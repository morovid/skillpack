import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashFiles } from "../../src/core/hash.js";

const file = (path: string, s: string | Buffer) => ({ path, content: Buffer.from(s) });
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

describe("hashFiles", () => {
  it("follows the documented format", () => {
    const expected = createHash("sha256")
      .update(`a.md\0${sha("x")}\n`)
      .update(`b/c.png\0${sha(Buffer.from([1, 2]))}\n`)
      .digest("hex");
    expect(hashFiles([file("b/c.png", Buffer.from([1, 2])), file("a.md", "x")])).toBe(`sha256-${expected}`);
  });
  it("ignores order and CRLF in text files only", () => {
    const a = hashFiles([file("a.md", "l1\nl2\n"), file("b.txt", "x")]);
    expect(hashFiles([file("b.txt", "x"), file("a.md", "l1\r\nl2\r\n")])).toBe(a);
    expect(hashFiles([file("a.bin", "l1\r\n")])).not.toBe(hashFiles([file("a.bin", "l1\n")]));
  });
  it("changes with content and path", () => {
    expect(hashFiles([file("a.md", "x")])).not.toBe(hashFiles([file("a.md", "y")]));
    expect(hashFiles([file("a.md", "x")])).not.toBe(hashFiles([file("b.md", "x")]));
  });
});
