export interface ScopedCapability {
  enabled: boolean;
  /** null = everything. */
  allow: string[] | null;
  deny: string[];
}

export type McpCapability = { kind: "none" } | { kind: "all" } | { kind: "servers"; servers: string[] };

export interface Capabilities {
  read: boolean;
  search: boolean;
  skills: boolean;
  web: boolean;
  questions: boolean;
  edit: ScopedCapability;
  shell: ScopedCapability;
  mcp: McpCapability;
}

type Raw = Record<string, unknown> | undefined;

const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);

function scoped(v: unknown): ScopedCapability {
  if (v === true) return { enabled: true, allow: null, deny: [] };
  if (typeof v === "object" && v !== null) {
    const o = v as { allow?: string[]; deny?: string[] };
    return { enabled: true, allow: o.allow ?? null, deny: o.deny ?? [] };
  }
  return { enabled: false, allow: null, deny: [] };
}

/** R-AGT-2a: read/search/skills default on; everything else off. */
export function normalizeCapabilities(raw: Raw): Capabilities {
  const c = raw ?? {};
  const mcp: McpCapability =
    c.mcp === true ? { kind: "all" } : Array.isArray(c.mcp) ? { kind: "servers", servers: c.mcp as string[] } : { kind: "none" };
  return {
    read: bool(c.read, true),
    search: bool(c.search, true),
    skills: bool(c.skills, true),
    web: bool(c.web, false),
    questions: bool(c.questions, false),
    edit: scoped(c.edit),
    shell: scoped(c.shell),
    mcp,
  };
}

/** True when a scoped capability has restrictions beyond on/off. */
export const isRestricted = (s: ScopedCapability): boolean => s.enabled && (s.allow !== null || s.deny.length > 0);
