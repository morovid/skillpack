export const HARNESSES = ["opencode", "codex"] as const;
export type Harness = (typeof HARNESSES)[number];

export interface HarnessInfo {
  displayName: string;
  /** Built-in subagents a pack agent may be bound to (R-CFG-1). */
  builtinAgents: readonly string[];
}

export const HARNESS_INFO: Record<Harness, HarnessInfo> = {
  opencode: { displayName: "OpenCode", builtinAgents: ["general", "explore"] },
  codex: { displayName: "Codex", builtinAgents: ["default", "worker", "explorer"] },
};

export const isHarness = (s: string): s is Harness => (HARNESSES as readonly string[]).includes(s);

/** Fixed order (OpenCode, then Codex), without duplicates. */
export const sortHarnesses = (hs: Iterable<Harness>): Harness[] => {
  const set = new Set(hs);
  return HARNESSES.filter((h) => set.has(h));
};
