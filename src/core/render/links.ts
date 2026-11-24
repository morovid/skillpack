const SCHEME = /^([a-z][a-z0-9+.-]*:|\/|#|\/\/)/i;

/** Maps `../<skill>/…` (exactly up to the skills folder) to the output folder name. */
function rewriteTarget(
  target: string,
  depth: number,
  skillNames: ReadonlySet<string>,
  folderName: (n: string) => string,
): string {
  if (SCHEME.test(target)) return target;
  const cut = target.search(/[?#]/);
  const path = cut === -1 ? target : target.slice(0, cut);
  const tail = cut === -1 ? "" : target.slice(cut);
  const m = /^((?:\.\.\/)+)([^/]+)(\/.*)?$/.exec(path);
  if (!m) return target;
  const ups = m[1]!.length / 3;
  const seg = m[2]!;
  if (ups !== depth + 1 || !skillNames.has(seg)) return target;
  return `${m[1]}${folderName(seg)}${m[3] ?? ""}${tail}`;
}

/**
 * Rewrites relative Markdown links (inline and reference definitions) that point at sibling skill
 * folders. `depth` is how many folders deep the file is inside its skill (SKILL.md = 0).
 */
export function rewriteSkillLinks(
  markdown: string,
  depth: number,
  skillNames: ReadonlySet<string>,
  folderName: (n: string) => string,
): string {
  const fix = (t: string): string => rewriteTarget(t, depth, skillNames, folderName);
  return markdown
    .replace(/(\]\(\s*<?)([^)\s>]+)/g, (_, pre: string, t: string) => pre + fix(t))
    .replace(/^([ ]{0,3}\[[^\]\n]+\]:[ \t]*<?)(\S+?)(?=>?(?:[ \t]|$))/gm, (_, pre: string, t: string) => pre + fix(t));
}
