export const BLOCK_START = "# >>> skillpack (managed; do not edit)";
export const BLOCK_END = "# <<< skillpack";

export class ExcludeBlockError extends Error {}

/** `/` + posix path without leading `./` or `/`. */
export const excludeLine = (path: string): string => `/${path.replaceAll("\\", "/").replace(/^(\.\/|\/)+/, "")}`;

export function parseExcludeBlock(text: string): { found: boolean; paths: string[] } {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(BLOCK_START);
  if (start === -1) return { found: false, paths: [] };
  const end = lines.indexOf(BLOCK_END, start + 1);
  if (end === -1) throw new ExcludeBlockError(`found "${BLOCK_START}" without "${BLOCK_END}"`);
  return { found: true, paths: lines.slice(start + 1, end).filter((l) => l.startsWith("/")) };
}

/**
 * Pure: returns the new exclude file text. Paths are added/removed inside the managed block only
 * (exact paths with a leading `/`, sorted, deduped). Lines outside the block are never touched. A
 * missing block is appended at the end; an empty block is removed.
 */
export function updateExcludeBlock(
  text: string,
  change: { add?: readonly string[]; remove?: readonly string[]; /** Replace the block's paths with exactly these. */ set?: readonly string[] },
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const hadFinalNewline = text.endsWith("\n");
  if (hadFinalNewline) lines.pop();

  const start = lines.indexOf(BLOCK_START);
  const end = start === -1 ? -1 : lines.indexOf(BLOCK_END, start + 1);
  if (start !== -1 && end === -1) throw new ExcludeBlockError(`found "${BLOCK_START}" without "${BLOCK_END}"`);

  const current = start === -1 ? [] : lines.slice(start + 1, end).filter((l) => l.startsWith("/"));
  const set = new Set(change.set ? change.set.map(excludeLine) : current);
  for (const p of change.add ?? []) set.add(excludeLine(p));
  for (const p of change.remove ?? []) set.delete(excludeLine(p));
  const paths = [...set].sort();

  const block = paths.length === 0 ? [] : [BLOCK_START, ...paths, BLOCK_END];
  let out: string[];
  if (start === -1) {
    if (block.length === 0) return text;
    out = [...lines, ...block];
  } else {
    out = [...lines.slice(0, start), ...block, ...lines.slice(end + 1)];
  }
  if (out.length === 0) return "";
  return out.join(eol) + eol;
}
