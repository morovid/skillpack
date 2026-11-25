import type { Harness } from "../harness.js";

export const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

export interface EffortResult {
  /** OpenCode: the variant to append as `#variant`. */
  variant?: string;
  /** Codex: `model_reasoning_effort`. */
  effort?: string;
  warning?: string;
}

/**
 * R-REQ-5. Codex: the effort as is (a warning when the model's listed efforts don't include it).
 * OpenCode: the model's variant of the same name; otherwise the nearest listed variant, with a
 * warning; when the variants are unknown (`opencode models` doesn't list them) the same name is
 * kept and reported as unverified.
 */
export function mapEffort(
  harness: Harness,
  effort: string | undefined,
  info: { variants?: readonly string[] | null; efforts?: readonly string[] | null } = {},
): EffortResult {
  if (effort === undefined) return {};
  if (harness === "codex") {
    if (info.efforts && !info.efforts.includes(effort)) {
      return { effort, warning: `effort "${effort}" isn't listed for this model (${info.efforts.join(", ")}); using it as given` };
    }
    return { effort };
  }
  const variants = info.variants;
  if (!variants) {
    return { variant: effort, warning: `OpenCode doesn't list variants, so effort "${effort}" is written as the variant "${effort}" without verification` };
  }
  if (variants.includes(effort)) return { variant: effort };
  const rank = (v: string): number => EFFORT_ORDER.indexOf(v as (typeof EFFORT_ORDER)[number]);
  const want = rank(effort);
  const near = variants
    .filter((v) => rank(v) >= 0 && want >= 0)
    .sort((a, b) => Math.abs(rank(a) - want) - Math.abs(rank(b) - want) || rank(a) - rank(b))[0];
  return near
    ? { variant: near, warning: `the model has no variant "${effort}"; using the nearest, "${near}"` }
    : { warning: `the model has no variant "${effort}" (variants: ${variants.join(", ") || "none"}); no variant used` };
}
