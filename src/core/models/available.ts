import { CommandError, runCommand } from "../exec.js";
import type { Harness } from "../harness.js";

export interface AvailableModel {
  /** OpenCode: `provider/model`. Codex: the model slug. */
  name: string;
  provider?: string;
  /** Reasoning efforts the harness lists for the model, when it says. */
  efforts?: string[];
}

/**
 * What a harness says about its models (R-REQ-1):
 * - ok: the list is known;
 * - unavailable: OpenCode's list couldn't be read, so models can't be matched;
 * - unverified: Codex's list couldn't be read, so any model name is accepted as given.
 */
export type ModelList =
  | { status: "ok"; models: AvailableModel[] }
  | { status: "unavailable" | "unverified"; reason: string };

export interface ModelSource {
  list(harness: Harness): Promise<ModelList>;
}

/** `opencode models`: one `provider/model` per line. Anything else is ignored. */
export function parseOpenCodeModels(stdout: string): AvailableModel[] {
  const seen = new Set<string>();
  const out: AvailableModel[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!/^[^\s/#]+\/[^\s#]+$/.test(line) || seen.has(line)) continue;
    seen.add(line);
    out.push({ name: line, provider: line.slice(0, line.indexOf("/")) });
  }
  return out;
}

/** `codex debug models --bundled`: `{ models: [{ slug, visibility, supported_reasoning_levels: [{ effort }] }] }`. */
export function parseCodexCatalog(stdout: string): AvailableModel[] {
  const doc = JSON.parse(stdout) as { models?: { slug?: string; visibility?: string; supported_reasoning_levels?: { effort?: string }[] }[] };
  const out: AvailableModel[] = [];
  for (const m of doc.models ?? []) {
    if (typeof m.slug !== "string" || (m.visibility !== undefined && m.visibility !== "list")) continue;
    const efforts = (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter((e): e is string => typeof e === "string");
    out.push({ name: m.slug, ...(efforts.length > 0 ? { efforts } : {}) });
  }
  return out;
}

/**
 * Reads the models from the installed harnesses, once per command run (no cache across runs).
 * OpenCode: `opencode models`; its output has no variants, so effort variants can't be verified.
 * Codex: `codex debug models --bundled`, the catalog bundled with the binary: it needs no network
 * and no login. A name it doesn't list is a no-match, as in OpenCode; only when the command can't
 * run is the list "unverified" and any name accepted.
 */
export function createSystemModelSource(env: NodeJS.ProcessEnv = process.env, run: typeof runCommand = runCommand): ModelSource {
  const memo = new Map<Harness, Promise<ModelList>>();
  const read = async (harness: Harness): Promise<ModelList> => {
    try {
      if (harness === "opencode") return { status: "ok", models: parseOpenCodeModels(await run("opencode", ["models"], { env })) };
      return { status: "ok", models: parseCodexCatalog(await run("codex", ["debug", "models", "--bundled"], { env })) };
    } catch (e) {
      const reason = e instanceof CommandError || e instanceof SyntaxError ? e.message : String(e);
      return { status: harness === "opencode" ? "unavailable" : "unverified", reason };
    }
  };
  return { list: (h) => memo.get(h) ?? memo.set(h, read(h)).get(h)! };
}
