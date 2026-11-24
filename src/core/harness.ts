export const HARNESSES = ["opencode", "codex"] as const;
export type Harness = (typeof HARNESSES)[number];
