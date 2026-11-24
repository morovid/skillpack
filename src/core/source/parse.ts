import { scopeProblem } from "../names.js";

export interface SourceSpec {
  /** Normalized source key (R-SRC-4). */
  key: string;
  /** URL passed to git. */
  cloneUrl: string;
  owner: string;
  repo: string;
  host: string;
  version?: string;
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

const SHORT = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function fail(input: string, why: string): never {
  throw new SourceError(`Invalid source "${input}": ${why}`);
}

/** Splits `path@version` at the LAST `@`. */
function splitVersion(input: string, path: string): { path: string; version?: string } {
  const at = path.lastIndexOf("@");
  if (at < 0) return { path };
  const version = path.slice(at + 1);
  if (!version.trim()) fail(input, "the version after '@' is empty");
  return { path: path.slice(0, at), version };
}

function cleanSegments(input: string, rawPath: string, host: string): string[] {
  let p = rawPath.replace(/\/+$/, "");
  p = p.replace(/\.git$/, "");
  const segs = p.split("/").filter((s) => s !== "");
  if (segs.length < 2) fail(input, "expected <owner>/<repo>");
  if (segs.some((s) => s === "." || s === "..")) fail(input, "path segments '.' and '..' aren't allowed");
  const tree = host === "github.com" ? segs[2] : segs.find((s, i) => i >= 2 && s === "-");
  if (tree === "tree" || tree === "blob" || tree === "-") {
    fail(input, "tree/<ref>/<path> URLs aren't supported; the pack is the repository root. Use <source>@<version> to pick a ref");
  }
  if (host === "github.com" && segs.length > 2) {
    fail(input, "packs in repository subfolders aren't supported; the pack must be the repository root");
  }
  return segs;
}

function build(input: string, kind: "https" | "ssh", authority: string, rawPath: string, version?: string, sshUser = "git"): SourceSpec {
  const host = authority.toLowerCase();
  const hostName = host.replace(/:\d+$/, "");
  if (!hostName) fail(input, "missing host");
  const segs = cleanSegments(input, rawPath, hostName);
  const path = segs.join("/");
  const key = kind === "https" ? `https://${host}/${path}` : `ssh://${sshUser}@${host}/${path}`;
  const spec: SourceSpec = {
    key,
    cloneUrl: key,
    owner: segs[0]!,
    repo: segs[segs.length - 1]!,
    host: hostName,
  };
  if (version !== undefined) spec.version = version;
  return spec;
}

/**
 * Parses a source (R-SRC-1). Keys (R-SRC-4): `owner/repo` and HTTPS URLs -> `https://host/owner/repo`.
 * SSH sources keep an SSH key `ssh://<user>@host/owner/repo`, so the same repo over HTTPS and SSH are different keys.
 */
export function parseSourceSpec(input: string): SourceSpec {
  const raw = input.trim();
  if (!raw) fail(input, "empty source");
  if (/^file:/i.test(raw)) fail(input, "file:// URLs aren't supported; every teammate must be able to fetch the pack");
  if (/^(\.{1,2}([/\\]|$)|[/\\~]|[A-Za-z]:[\\/])/.test(raw)) {
    fail(input, "local paths aren't supported; use render to preview a local pack");
  }

  const url = /^(https?|ssh):\/\/(.*)$/i.exec(raw);
  if (url) {
    const scheme = url[1]!.toLowerCase();
    const rest = url[2]!;
    const slash = rest.indexOf("/");
    if (slash < 0) fail(input, "expected <owner>/<repo>");
    let authority = rest.slice(0, slash);
    const { path, version } = splitVersion(input, rest.slice(slash + 1));
    let user = "git";
    const at = authority.lastIndexOf("@");
    if (at >= 0) {
      user = authority.slice(0, at);
      authority = authority.slice(at + 1);
    }
    if (scheme === "ssh") return build(input, "ssh", authority, path, version, user || "git");
    if (scheme === "http") fail(input, "use https://");
    if (at >= 0) fail(input, "credentials in URLs aren't supported; use a git credential helper");
    return build(input, "https", authority, path, version);
  }

  const scp = /^([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+):(.+)$/.exec(raw);
  if (scp) {
    const { path, version } = splitVersion(input, scp[3]!);
    return build(input, "ssh", scp[2]!, path, version, scp[1]!);
  }

  const { path, version } = splitVersion(input, raw);
  if (!SHORT.test(path.replace(/\.git$/, ""))) fail(input, "expected owner/repo, a git URL (https or ssh), optionally followed by @<version>");
  return build(input, "https", "github.com", path, version);
}

export function normalizeSourceKey(input: string): string {
  return parseSourceSpec(input).key;
}

/** True when `ref` (a scope or a source in any accepted form) names the pack (R-CLI-7). */
export function matchesPackRef(ref: string, key: string, scope: string): boolean {
  if (ref === scope) return true;
  try {
    return parseSourceSpec(ref).key === key;
  } catch {
    return false;
  }
}

/** Default scope from a repo owner (R-SRC-3), or null when the result isn't a valid scope (`--as` needed). */
export function scopeFromOwner(owner: string): string | null {
  const s = owner.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  if (!s || scopeProblem(s)) return null;
  return s;
}
