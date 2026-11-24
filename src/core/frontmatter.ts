import { parse } from "yaml";

export type Frontmatter =
  | { kind: "none"; body: string }
  | { kind: "error"; message: string; body: string }
  | { kind: "ok"; data: Record<string, unknown>; body: string };

const FENCE = /^---[ \t]*$/;

export function parseFrontmatter(text: string): Frontmatter {
  const src = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const lines = src.split(/\r?\n/);
  if (!FENCE.test(lines[0] ?? "")) return { kind: "none", body: src };
  const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
  if (end === -1) return { kind: "error", message: "frontmatter is not closed with ---", body: src };
  const body = lines.slice(end + 1).join("\n");
  let data: unknown;
  try {
    data = parse(lines.slice(1, end).join("\n"));
  } catch (e) {
    return { kind: "error", message: `invalid YAML: ${(e as Error).message.split("\n")[0]}`, body };
  }
  if (data === null || data === undefined) return { kind: "ok", data: {}, body };
  if (typeof data !== "object" || Array.isArray(data)) {
    return { kind: "error", message: "frontmatter must be a YAML mapping", body };
  }
  return { kind: "ok", data: data as Record<string, unknown>, body };
}

export interface FrontmatterParts {
  bom: string;
  /** The YAML between the fences, including its final newline (empty when there is none). */
  yaml: string;
  /** Everything after the closing fence line, including that line's newline. */
  rest: string;
  eol: "\n" | "\r\n";
}

/** Splits raw text at the frontmatter fences without interpreting the YAML. Null when there is none. */
export function splitFrontmatter(text: string): FrontmatterParts | null {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const src = text.slice(bom.length);
  const m = /^---[ \t]*\r?\n((?:[\s\S]*?\r?\n)?)---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return null;
  return { bom, yaml: m[1]!, rest: src.slice(m[0].length), eol: src.includes("\r\n") ? "\r\n" : "\n" };
}
