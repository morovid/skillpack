import type { AvailableModel } from "./available.js";

/** Lowercase, `.`/`_`/space to `-`, provider prefix and `#variant` dropped (R-REQ-3). */
export function normalizeModelName(name: string): string {
  const noVariant = name.split("#")[0]!;
  const model = noVariant.slice(noVariant.lastIndexOf("/") + 1);
  return model.toLowerCase().replace(/[._\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

const parts = (name: string): string[] => normalizeModelName(name).split("-").filter(Boolean);

/** True when the requested name's `-` parts appear, whole and in a row, in the candidate's: `sonnet-5.5` is in `claude-sonnet-5-5` but not in `sonnet-5-50`. */
export function matchesRequested(candidate: string, requested: string): boolean {
  const c = parts(candidate);
  const r = parts(requested);
  if (r.length === 0 || r.length > c.length) return false;
  for (let i = 0; i + r.length <= c.length; i++) if (r.every((p, j) => c[i + j] === p)) return true;
  return false;
}

export interface MatchResult {
  /** The requested name that matched. */
  name: string;
  /** Sorted by full name. More than one means the match is ambiguous. */
  candidates: AvailableModel[];
}

/**
 * Tries the requested names in the agent's order; the first with a match wins. If some candidates
 * equal the requested name exactly (after normalizing), only those count, so `gpt-6-luna` doesn't
 * become ambiguous with `gpt-6-luna-mini`.
 */
export function findMatch(requested: readonly string[], available: readonly AvailableModel[]): MatchResult | null {
  for (const name of requested) {
    let hits = available.filter((m) => matchesRequested(m.name, name));
    if (hits.length === 0) continue;
    const exact = hits.filter((m) => normalizeModelName(m.name) === normalizeModelName(name));
    if (exact.length > 0) hits = exact;
    return { name, candidates: [...hits].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) };
  }
  return null;
}
