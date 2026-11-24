import { NAME_PATTERN } from "./names.js";

export type Token =
  | { kind: "text"; raw: string; start: number; end: number; line: number; col: number }
  | { kind: "escape"; raw: string; start: number; end: number; line: number; col: number }
  | { kind: "scope"; raw: string; start: number; end: number; line: number; col: number }
  | { kind: "agent" | "skill"; name: string; raw: string; start: number; end: number; line: number; col: number }
  | { kind: "unclosed"; raw: string; start: number; end: number; line: number; col: number }
  | { kind: "unknown"; raw: string; start: number; end: number; line: number; col: number };

export type PlaceholderToken = Exclude<Token, { kind: "text" | "escape" }>;

const NAME = NAME_PATTERN.source.slice(1, -1);
const AGENT = new RegExp(`^agent:(${NAME})$`);
const SKILL = new RegExp(`^skill:(${NAME})$`);

/**
 * Splits text into text, escape (`\{{`), and placeholder tokens. Concatenating
 * every token's `raw` gives back the input, so a renderer can map over the tokens.
 * A `{{` without a closing `}}` on the same line becomes an `unclosed` token (raw is just `{{`).
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let lineStart = 0;
  let textStart = 0;
  let i = 0;

  const flush = (end: number): void => {
    if (end > textStart) {
      tokens.push({
        kind: "text",
        raw: text.slice(textStart, end),
        start: textStart,
        end,
        line: lineAt(textStart),
        col: colAt(textStart),
      });
    }
  };
  // Line/col of an offset (computed from the text; tokens are rare enough).
  const lineAt = (off: number): number => text.slice(0, off).split("\n").length;
  const colAt = (off: number): number => off - (text.lastIndexOf("\n", off - 1) + 1) + 1;

  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      line++;
      lineStart = i + 1;
      i++;
    } else if (ch === "\\" && text.startsWith("{{", i + 1)) {
      flush(i);
      tokens.push({ kind: "escape", raw: "\\{{", start: i, end: i + 3, line, col: i - lineStart + 1 });
      i += 3;
      textStart = i;
    } else if (ch === "{" && text.startsWith("{{", i)) {
      const nl = text.indexOf("\n", i);
      const lineEnd = nl === -1 ? text.length : nl;
      const close = text.indexOf("}}", i + 2);
      if (close === -1 || close >= lineEnd) {
        flush(i);
        tokens.push({ kind: "unclosed", raw: "{{", start: i, end: i + 2, line, col: i - lineStart + 1 });
        i += 2;
        textStart = i;
        continue;
      }
      flush(i);
      const raw = text.slice(i, close + 2);
      const inner = text.slice(i + 2, close);
      const base = { raw, start: i, end: close + 2, line, col: i - lineStart + 1 };
      const a = AGENT.exec(inner);
      const s = SKILL.exec(inner);
      if (inner === "scope") tokens.push({ kind: "scope", ...base });
      else if (a) tokens.push({ kind: "agent", name: a[1]!, ...base });
      else if (s) tokens.push({ kind: "skill", name: s[1]!, ...base });
      else tokens.push({ kind: "unknown", ...base });
      i = close + 2;
      textStart = i;
    } else {
      i++;
    }
  }
  flush(text.length);
  return tokens;
}

export function findPlaceholders(text: string): PlaceholderToken[] {
  return tokenize(text).filter((t): t is PlaceholderToken => t.kind !== "text" && t.kind !== "escape");
}

export interface PlaceholderResolver {
  agent(name: string): string;
  skill(name: string): string;
  scope: string;
}

export class PlaceholderError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(`${message} (line ${line}, column ${col})`);
  }
}

/** Replaces placeholders; `\{{` becomes a literal `{{`. Throws PlaceholderError on unknown or unclosed ones. */
export function renderPlaceholders(text: string, resolver: PlaceholderResolver): string {
  let out = "";
  for (const t of tokenize(text)) {
    switch (t.kind) {
      case "text":
        out += t.raw;
        break;
      case "escape":
        out += "{{";
        break;
      case "scope":
        out += resolver.scope;
        break;
      case "agent":
        out += resolver.agent(t.name);
        break;
      case "skill":
        out += resolver.skill(t.name);
        break;
      case "unclosed":
        throw new PlaceholderError("unclosed placeholder", t.line, t.col);
      case "unknown":
        throw new PlaceholderError(`unknown placeholder ${t.raw}`, t.line, t.col);
    }
  }
  return out;
}
