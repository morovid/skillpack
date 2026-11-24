import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

export const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml"]);

export function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

export interface TextFile {
  /** Path relative to the walked root, with `/` separators. */
  rel: string;
  abs: string;
  text: string;
}

export function readTextFiles(root: string): TextFile[] {
  const out: TextFile[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && isTextFile(e.name)) {
        out.push({
          rel: relative(root, abs).split("\\").join("/"),
          abs,
          text: readFileSync(abs, "utf8"),
        });
      }
    }
  };
  walk(root);
  return out;
}
