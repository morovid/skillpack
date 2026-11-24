import { createHash } from "node:crypto";
import { isTextFile } from "./text-files.js";
import { readTree, sortFiles } from "./fs/tree.js";

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

/**
 * Folder hash (requirements §4.9): SHA-256 over files sorted by posix path, each contributing
 * `path NUL sha256(content) \n`. Text files have CRLF replaced by LF first. Returns `sha256-<hex>`.
 */
export function hashFiles(files: { path: string; content: Buffer }[]): string {
  const h = createHash("sha256");
  for (const f of sortFiles(files)) {
    const content = isTextFile(f.path) ? Buffer.from(f.content.toString("utf8").replaceAll("\r\n", "\n")) : f.content;
    h.update(`${f.path}\0${sha256(content)}\n`);
  }
  return `sha256-${h.digest("hex")}`;
}

export function hashFolder(dir: string): string {
  return hashFiles(readTree(dir));
}
