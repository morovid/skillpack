import type { AgentWarning } from "./agents/types.js";
import type { Diagnostic } from "./diagnostics.js";
import { HARNESS_INFO } from "./harness.js";

export interface Style {
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  bold(s: string): string;
  dim(s: string): string;
}

export function colorEnabled(stream: { isTTY?: boolean }, env = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return stream.isTTY === true;
}

export function createStyle(enabled: boolean): Style {
  const wrap = (open: number, close: number) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    bold: wrap(1, 22),
    dim: wrap(2, 22),
  };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Diagnostics grouped by file, one line each. */
export function formatDiagnostics(items: Diagnostic[], s: Style): string {
  const groups = new Map<string, Diagnostic[]>();
  for (const d of items) groups.set(d.file ?? "", [...(groups.get(d.file ?? "") ?? []), d]);
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  let out = "";
  for (const key of keys) {
    out += `${s.bold(key === "" ? "(pack)" : key)}\n`;
    for (const d of groups.get(key)!) {
      const label = d.level === "error" ? s.red("error  ") : s.yellow("warning");
      const line = d.line !== undefined ? s.dim(`:${d.line}`.padEnd(5)) : "     ";
      out += `  ${line} ${label}  ${d.message}  ${s.dim(d.code)}\n`;
    }
    out += "\n";
  }
  return out;
}

/**
 * Agent warnings, one line each. Unless `verbose`, the unenforced restrictions of one
 * agent × harness collapse into a single summary line; other kinds always get their own line.
 */
export function formatAgentWarnings(warnings: AgentWarning[], s: Style, verbose = false): string {
  let out = "";
  const counts = new Map<string, { w: AgentWarning; n: number }>();
  const line = (w: AgentWarning, text: string): string =>
    `  ${s.yellow(w.kind.padEnd(11))} ${w.agent} (${HARNESS_INFO[w.harness].displayName}): ${text}\n`;
  for (const w of warnings) {
    if (w.kind === "unenforced" && !verbose) {
      const key = `${w.agent}\0${w.harness}`;
      const e = counts.get(key);
      if (e) e.n++;
      else {
        counts.set(key, { w, n: 1 });
        out += `\0${key}\0`;
      }
    } else out += line(w, w.message);
  }
  for (const [key, { w, n }] of counts) {
    out = out.replace(`\0${key}\0`, line(w, `${plural(n, "restriction")} not enforced (listed in the agent's instructions)`));
  }
  return out;
}
